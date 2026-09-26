import { useState } from 'react';
import { type Capability, type LimitValue, type ModelView, REQUEST_TYPES, ROUTES } from '@/ai/shared/models';
import { List, Row, Toggle } from '@/components/ui/forms';
import { Button, Card, cx } from '@/components/ui/primitives';
import { effectiveLimits, formatLimit, modelIndicator } from '@/domain/aiRouter';
import { saveSettings } from '@/services/adminService';
import { clearRouterStats } from '@/services/ai/routerState';
import { useAi } from '@/store/aiStore';
import { useGame } from '@/store/gameStore';
import type { Settings } from '@/types';
import { formatInt } from '@/utils/format';

const CAP_LABEL: Partial<Record<Capability, string>> = { imageInput: 'Images', functionCalling: 'Tools', structuredOutput: 'JSON', audioInput: 'Audio', live: 'Live' };
const TONE = { ok: 'text-success', notice: 'text-warn', warn: 'text-warn', bad: 'text-danger', off: 'text-muted' } as const;

function secondsLeft(until?: number): string | undefined {
  if (!until || until <= Date.now()) return undefined;
  const s = Math.ceil((until - Date.now()) / 1000);
  return s < 120 ? `~${s} sec` : s < 7200 ? `~${Math.ceil(s / 60)} min` : `~${Math.round(s / 3600)} h`;
}

function useAiSettings() {
  const settings = useGame((s) => s.settings)!;
  const refresh = useGame((s) => s.refresh);
  const saveAi = async (patch: Partial<Settings['coach']['ai']>) => {
    await saveSettings({ ...settings, coach: { ...settings.coach, ai: { ...settings.coach.ai, ...patch } } });
    await refresh();
  };
  return { settings, ai: settings.coach.ai, saveAi };
}

/** AI SYSTEM: provider, cost mode, router state and model counts. */
export function AiSystemCard() {
  const { ai } = useAiSettings();
  const { status, models, router, modelsLoading, refreshModels } = useAi();
  const list = models?.models ?? [];
  const usable = list.filter((m) => m.usable);
  const cooling = usable.filter((m) => Math.max(m.cooldownUntil ?? 0, router.health[m.id]?.cooldownUntil ?? 0) > Date.now());
  const rows: [string, string][] = [
    ['Provider', 'Google Gemini'],
    ['Mode', ai.freeTierOnly ? 'FREE TIER ONLY' : models?.allowPaid ? 'Paid models allowed' : 'FREE TIER ONLY (server)'],
    ['Router', models?.state === 'connected' ? 'ACTIVE' : status?.state === 'not_configured' ? 'NOT CONNECTED' : 'WAITING'],
    ['Available models', String(usable.length)],
    ['Healthy', String(usable.length - cooling.length)],
    ['Rate limited', String(cooling.length)],
    ['Unavailable', String(list.length - usable.length)],
  ];
  return (
    <Card className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-extrabold tracking-[0.14em] text-muted">AI SYSTEM</div>
        <Button size="sm" variant="tinted" icon="refresh" loading={modelsLoading} onClick={() => void refreshModels(true)}>
          Refresh models
        </Button>
      </div>
      <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {models && !models.discovered && models.state === 'connected' && <p className="mt-2 text-[12px] text-muted">Model list unavailable from Google right now: only the configured model is known.</p>}
      {models?.discoveredAt && <p className="mt-2 text-[11px] text-muted">Models discovered {new Date(models.discoveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} from your API key.</p>}
    </Card>
  );
}

/** Settings → AI → Cost Control. */
export function CostControl() {
  const { ai, saveAi } = useAiSettings();
  const models = useAi((s) => s.models);
  const refreshModels = useAi((s) => s.refreshModels);
  return (
    <>
      <List title="Cost Control" footer="FREE TIER ONLY uses only models verified as Gemini Free Tier (documented Free Tier models, or ones you list in GEMINI_FREE_MODELS on the server). If a model can’t be verified it is never used automatically. The strongest protection is a Google AI Studio project without billing: then nothing can be charged at all.">
        <Row
          title="FREE TIER ONLY"
          subtitle={ai.freeTierOnly ? 'On — no paid upgrades, ever' : 'Off'}
          right={
            <Toggle
              checked={ai.freeTierOnly}
              onChange={async (v) => {
                await saveAi({ freeTierOnly: v });
                await refreshModels();
              }}
              label="FREE TIER ONLY"
            />
          }
        />
      </List>
      {!ai.freeTierOnly && (
        <p className="mt-1.5 rounded-2xl bg-warn/10 px-4 py-2 text-[12px]">
          {models?.allowPaid
            ? '⚠️ Paid models may now be used and can generate costs if billing is enabled on your Google project.'
            : 'Paid models stay blocked: the server also requires GEMINI_ALLOW_PAID=true. LifeForge keeps using Free Tier models only.'}
        </p>
      )}
    </>
  );
}

function LimitCell({ label, value, learned }: { label: string; value?: LimitValue; learned?: LimitValue }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-1.5 text-center">
      <div className="text-[10px] font-bold tracking-wider text-muted">{label}</div>
      <div className="num text-[13px] font-semibold">{formatLimit(learned ?? value)}</div>
      <div className="text-[9px] text-faint">{learned !== undefined ? 'Google' : value !== undefined ? 'you' : ''}</div>
    </div>
  );
}

function parseLimit(v: string): LimitValue | undefined {
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  if (t.startsWith('unl') || t === '∞') return 'unlimited';
  const n = Math.round(Number(t.replace(/[^\d]/g, '')));
  return n > 0 ? n : undefined;
}

function ModelCard({ m }: { m: ModelView }) {
  const { settings, ai, saveAi } = useAiSettings();
  const { router, perModel } = useAi();
  const [editing, setEditing] = useState(false);
  const own = ai.usage.modelLimits?.[m.id] ?? {};
  const [draft, setDraft] = useState({ rpm: own.rpm?.toString() ?? '', tpm: own.tpm?.toString() ?? '', rpd: own.rpd?.toString() ?? '' });
  const local = router.health[m.id];
  const usage = perModel[m.id];
  const limits = effectiveLimits(m.id, settings.coach.ai.usage, router);
  const ind = modelIndicator(m, local, usage, limits);
  const cooldown = secondsLeft(Math.max(m.cooldownUntil ?? 0, local?.cooldownUntil ?? 0));
  const learned = { ...m.learnedLimits, ...(local?.learned ?? {}) };
  const save = async () => {
    const next = { rpm: parseLimit(draft.rpm), tpm: parseLimit(draft.tpm), rpd: parseLimit(draft.rpd) };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    const all = { ...(ai.usage.modelLimits ?? {}) };
    if (Object.keys(clean).length) all[m.id] = clean;
    else delete all[m.id];
    await saveAi({ usage: { ...ai.usage, modelLimits: all } });
    setEditing(false);
  };
  return (
    <div className="rounded-2xl bg-surface p-3 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-snug font-bold break-all">{m.id}</div>
          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] font-bold">
            <span className={cx('rounded-full px-1.5 py-0.5', m.freeTier === 'free' ? 'bg-success/15 text-success' : m.freeTier === 'paid' ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted')}>{m.freeTier === 'free' ? 'FREE TIER' : m.freeTier === 'paid' ? 'PAID' : 'NOT VERIFIED'}</span>
            {m.preview && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted">PREVIEW</span>}
            {(Object.keys(CAP_LABEL) as Capability[])
              .filter((c) => m.capabilities[c] === true)
              .map((c) => (
                <span key={c} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-muted">
                  {CAP_LABEL[c]}
                </span>
              ))}
          </div>
        </div>
        <span className={cx('shrink-0 text-[12px] font-bold', TONE[ind.tone])}>
          {ind.icon} {ind.label}
        </span>
      </div>
      {cooldown && <div className="mt-1 text-[12px] text-danger">Cooldown: {cooldown}</div>}
      {m.excluded && <div className="mt-1 text-[12px] text-muted">{m.excluded}</div>}
      <div className="num mt-2 text-[12px] text-muted">
        Requests: <b className="text-fg">{usage?.requests ?? 0}</b> · today (PT) {usage?.dayRequests ?? 0} · last min {usage?.minuteRequests ?? 0}
        {usage?.rateLimits ? ` · 429s ${usage.rateLimits}` : ''}
        {usage ? ` · ${formatInt(usage.inputTokens)} in / ${formatInt(usage.outputTokens)} out tok.` : ''}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <LimitCell label="RPM" value={own.rpm} learned={learned.rpm} />
        <LimitCell label="TPM" value={own.tpm} learned={learned.tpm} />
        <LimitCell label="RPD" value={own.rpd} learned={learned.rpd} />
      </div>
      {editing ? (
        <div className="mt-2">
          <div className="grid grid-cols-3 gap-1.5">
            {(['rpm', 'tpm', 'rpd'] as const).map((k) => (
              <input key={k} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={k.toUpperCase()} aria-label={`${m.id} ${k}`} inputMode="text" className="h-11 min-w-0 rounded-xl border border-line bg-surface px-2 text-center text-[14px] outline-none focus:border-accent" />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">Copy from AI Studio. A number, “unlimited”, or empty = Unknown.</p>
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={() => void save()}>
              Save limits
            </Button>
          </div>
        </div>
      ) : (
        m.usable && (
          <button type="button" onClick={() => setEditing(true)} className="mt-1 min-h-11 text-[13px] font-semibold text-accent">
            Enter limits from AI Studio
          </button>
        )
      )}
    </div>
  );
}

/** MODEL USAGE: per-model health, requests (app estimate) and limits (Google / you / Unknown). */
export function ModelUsageSection() {
  const models = useAi((s) => s.models);
  const [showAll, setShowAll] = useState(false);
  if (!models || !models.models.length) return <p className="mt-2 px-4 text-[12px] text-muted">{models?.message ?? 'Models appear here once Gemini is connected.'}</p>;
  const usable = models.models.filter((m) => m.usable);
  const others = models.models.filter((m) => !m.usable);
  return (
    <div className="mt-2 space-y-2">
      <div className="px-4 text-[13px] font-semibold text-muted">MODEL USAGE</div>
      {usable.map((m) => (
        <ModelCard key={m.id} m={m} />
      ))}
      {others.length > 0 && (
        <button type="button" onClick={() => setShowAll((x) => !x)} className="min-h-11 w-full text-[13px] font-semibold text-accent">
          {showAll ? 'Hide' : 'Show'} {others.length} models not used by LifeForge
        </button>
      )}
      {showAll && others.map((m) => <ModelCard key={m.id} m={m} />)}
      <p className="px-4 text-[11px] text-muted">
        Requests are counted on this device (APP ESTIMATE). Limits marked “Google” come from Google’s own rate-limit errors; “you” are values you entered; Unknown is never treated as Unlimited, and Unlimited RPM still respects TPM and RPD.
      </p>
    </div>
  );
}

/** Settings → AI → Advanced (debugging). */
export function AdvancedRouter() {
  const { router, models } = useAi();
  const [cleared, setCleared] = useState(false);
  return (
    <details className="mt-6 rounded-3xl bg-surface p-4 shadow-card">
      <summary className="flex min-h-11 cursor-pointer items-center text-[16px] font-bold">Advanced · model router</summary>
      <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Current model</dt>
        <dd className="text-right font-semibold break-all">{router.currentModel ?? '—'}</dd>
        <dt className="text-muted">Last model</dt>
        <dd className="text-right font-semibold break-all">{router.lastModel ?? '—'}</dd>
        <dt className="text-muted">Last request</dt>
        <dd className="text-right font-semibold">{router.lastRequestType ?? '—'}</dd>
        <dt className="text-muted">Fallback count</dt>
        <dd className="text-right font-semibold">{router.fallbackCount}</dd>
        <dt className="text-muted">Rate limits encountered</dt>
        <dd className="text-right font-semibold">{router.rateLimits}</dd>
      </dl>
      {router.lastReason && (
        <p className="mt-2 rounded-2xl bg-surface-2 px-3 py-2 text-[12px]">
          <b>Selected:</b> {router.currentModel} · <b>Reason:</b> {router.lastReason}
        </p>
      )}
      <div className="mt-3 text-[12px] font-bold tracking-wider text-muted">MODEL AVAILABILITY BY REQUEST TYPE</div>
      <ul className="mt-1 space-y-1 text-[12px]">
        {REQUEST_TYPES.map((r) => (
          <li key={r} className="break-words">
            <b>{ROUTES[r].label}</b>: {models?.routes[r]?.length ? models.routes[r].join(' → ') : <span className="text-muted">no compatible Free Tier model</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 text-[12px] font-bold tracking-wider text-muted">LAST ERRORS</div>
      {router.lastErrors.length ? (
        <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
          {router.lastErrors.map((e, i) => (
            <li key={i} className="break-all">
              {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {e.model} · {e.outcome.replace('_', ' ')}
              {e.status ? ` (${e.status})` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12px] text-muted">None.</p>
      )}
      <Button
        block
        variant="secondary"
        className="mt-3"
        onClick={async () => {
          await clearRouterStats();
          setCleared(true);
        }}
      >
        {cleared ? 'Router memory cleared' : 'Reset router memory'}
      </Button>
    </details>
  );
}
