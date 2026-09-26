import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Field, List, NumberInput, Row, Segmented, Select, Toggle } from '@/components/ui/forms';
import { Button, Card, cx } from '@/components/ui/primitives';
import { LIMIT_LABEL, type PeriodUsage } from '@/domain/aiUsage';
import { saveSettings } from '@/services/adminService';
import { clearChangeLog } from '@/services/ai/changeLog';
import { clearAiHistory } from '@/services/ai/orchestrator';
import { clearUsage, OFFICIAL_USAGE_URL } from '@/services/ai/usageService';
import { effectiveLimits, modelPressure } from '@/domain/aiRouter';
import { AdvancedRouter, AiSystemCard, CostControl, ModelUsageSection } from './ModelRouterPanel';
import { loadChat } from '@/services/coachService';
import { type AiUiState, useAi } from '@/store/aiStore';
import { useGame } from '@/store/gameStore';
import type { CoachPersonality, Settings } from '@/types';
import { formatInt } from '@/utils/format';

const VOICE_LANGS = [
  { value: '', label: 'Device language' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
];

const STATE_VIEW: Record<AiUiState, { label: string; tone: string; dot: string }> = {
  not_connected: { label: 'NOT CONNECTED', tone: 'text-muted', dot: '⚪' },
  connecting: { label: 'CONNECTING…', tone: 'text-muted', dot: '🔄' },
  connected: { label: 'CONNECTED', tone: 'text-success', dot: '🟢' },
  error: { label: 'ERROR', tone: 'text-danger', dot: '🔴' },
  quota: { label: 'QUOTA EXCEEDED', tone: 'text-danger', dot: '🔴' },
  invalid_key: { label: 'INVALID KEY', tone: 'text-danger', dot: '🔴' },
  server_error: { label: 'SERVER ERROR', tone: 'text-danger', dot: '🔴' },
  offline: { label: 'OFFLINE', tone: 'text-muted', dot: '⚪' },
};


const STEPS = [
  'Open Google AI Studio (aistudio.google.com) and sign in with your Google account.',
  'Use a Gemini API key from a Google AI Studio Free Tier project: create a project (or use the default one) and press “Get API key” → “Create API key”.',
  'Do not enable paid billing if you want to keep this at €0.',
  'In Vercel, open your LifeForge project → Settings → Environment Variables.',
  'Add GEMINI_API_KEY with your key (never put it in the app, the code or git). Optional: GEMINI_MODEL to choose a model (default: gemini-flash-latest).',
  'Redeploy the project (Deployments → … → Redeploy) so the serverless API picks up the key.',
  'Come back here and press TEST CONNECTION.',
];

function useCoachSettings() {
  const settings = useGame((s) => s.settings)!;
  const refresh = useGame((s) => s.refresh);
  const save = async (patch: Partial<Settings['coach']>) => {
    await saveSettings({ ...settings, coach: { ...settings.coach, ...patch } });
    await refresh();
  };
  return { settings, save };
}

function PeriodTable({ rows }: { rows: [string, PeriodUsage][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-left text-[13px]">
        <thead className="text-[11px] text-muted">
          <tr>
            <th className="py-1 pr-2 font-semibold">Period</th>
            <th className="py-1 pr-2 text-right font-semibold">Requests</th>
            <th className="py-1 pr-2 text-right font-semibold">Input tok.</th>
            <th className="py-1 pr-2 text-right font-semibold">Output tok.</th>
            <th className="py-1 text-right font-semibold">Total tok.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, p]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 pr-2 font-semibold">{label}</td>
              <td className="py-1.5 pr-2 text-right">
                {p.requests}
                {p.failed > 0 && <span className="text-[11px] text-danger"> ({p.failed} failed)</span>}
              </td>
              <td className="py-1.5 pr-2 text-right">{formatInt(p.inputTokens)}</td>
              <td className="py-1.5 pr-2 text-right">{formatInt(p.outputTokens)}</td>
              <td className="py-1.5 text-right">{formatInt(p.totalTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function resetInfo(key: string): string {
  if (key === 'rpm' || key === 'tpm') return 'Per-minute limits free up within about a minute.';
  if (key === 'rpd' || key === 'tpd') return 'Daily limits reset once a day (Google documents midnight Pacific time; check AI Studio).';
  return 'See Google AI Studio for when it resets.';
}

/** Settings → AI: Gemini connection, preferences, usage monitor, privacy and setup guide. */
export function AiPanel() {
  const { settings, save } = useCoachSettings();
  const ai = settings.coach.ai;
  const { ui, status, usage, check, refreshUsage, refreshModels, models, perModel, router } = useAi();
  const pressure = (models?.models ?? [])
    .filter((m) => m.usable)
    .map((m) => modelPressure(m.id, perModel[m.id], effectiveLimits(m.id, settings.coach.ai.usage, router)))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => b.pct - a.pct)[0];
  const location = useLocation();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  useEffect(() => {
    void check();
    void refreshUsage();
    void refreshModels();
  }, [check, refreshUsage, refreshModels]);
  useEffect(() => {
    if (location.hash === '#usage') setTimeout(() => document.getElementById('usage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, [location.hash]);

  const saveAi = (patch: Partial<Settings['coach']['ai']>) => save({ ai: { ...ai, ...patch } });
  const saveUsage = (patch: Partial<Settings['coach']['ai']['usage']>) => saveAi({ usage: { ...ai.usage, ...patch } });
  const view = STATE_VIEW[ui];

  const test = async () => {
    setTesting(true);
    setTested(null);
    const s = await check({ test: true });
    setTesting(false);
    if (s?.state === 'connected') setTested(`Test OK · ${s.modelName ?? s.model}${s.usage?.totalTokens ? ` · ${s.usage.totalTokens} tokens used` : ''}`);
  };

  const u = usage;

  return (
    <div className="mt-3">
      {/* ——— Status ——— */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-muted">Gemini status</div>
          <span className={cx('text-[13px] font-extrabold tracking-[0.12em]', view.tone)}>
            {view.dot} {view.label}
          </span>
        </div>
        <div className="mt-2 text-[14px]">
          Model: <b className="break-all">{status?.modelName || status?.model || '—'}</b>
          {status?.resolvedModel && status.resolvedModel !== status.model && <span className="text-muted"> ({status.resolvedModel})</span>}
        </div>
        {status?.message && ui !== 'connected' && <p className="mt-1 text-[13px] text-danger">{status.message}</p>}
        {ui === 'quota' && <p className="mt-1 text-[13px] text-muted">Gemini Free Tier quota is currently unavailable. The basic coach keeps working.</p>}
        {ui === 'not_connected' && <p className="mt-1 text-[13px] text-muted">LifeForge works fully without AI. Connect Gemini for the AI Coach and food photos — see “How to connect Gemini” below.</p>}
        {tested && <p className="mt-1 text-[13px] font-semibold text-success">{tested}</p>}
        <Button block className="mt-3" icon="refresh" loading={testing} onClick={() => void test()}>
          TEST CONNECTION
        </Button>
        <p className="mt-2 text-[12px] text-muted">The test sends one tiny request to Gemini (it counts toward your usage).</p>
      </Card>

      <AiSystemCard />

      {/* ——— Preferences ——— */}
      <List title="AI features">
        <Row title="Use Gemini" subtitle="Off = basic coach only, nothing sent" right={<Toggle checked={ai.enabled} onChange={(v) => void saveAi({ enabled: v })} label="Use Gemini" />} />
        <Row title="Food Vision" subtitle="Estimate meals from photos" right={<Toggle checked={ai.foodVision} onChange={(v) => void saveAi({ foodVision: v })} label="Food Vision" />} />
        <Row title="Save Food Photos" subtitle="Small thumbnail on this device only" right={<Toggle checked={ai.savePhotos} onChange={(v) => void saveAi({ savePhotos: v })} label="Save Food Photos" />} />
      </List>
      <CostControl />
      <div className="mt-4 px-1">
        <div className="mb-1.5 px-3 text-[13px] font-semibold text-muted">Coach personality</div>
        <Segmented<CoachPersonality>
          value={settings.coach.personality}
          onChange={(v) => void save({ personality: v })}
          options={[
            { value: 'gentle', label: 'Gentle' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'direct', label: 'Direct' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
      </div>
      <List title="Voice">
        <Row title="Microphone buttons" right={<Toggle checked={settings.coach.voice} onChange={(v) => void save({ voice: v })} label="Microphone buttons" />} />
        <Row title="Voice language" right={<Select value={settings.coach.voiceLang} onChange={(v) => void save({ voiceLang: v })} options={VOICE_LANGS} aria-label="Voice language" className="!h-11 w-[170px]" />} />
      </List>
      <p className="mt-1.5 px-4 text-[12px] text-muted">Voice uses your browser’s speech recognition. Where it isn’t available, the 🎙️ key on the iPhone keyboard works in every text field.</p>

      {/* ——— Usage ——— */}
      <div id="usage" className="scroll-mt-20" />
      <div className="mt-6 mb-1.5 px-4 text-[13px] font-semibold text-muted">GEMINI USAGE</div>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.14em]">APP ESTIMATE</span>
          <span className="text-[12px] text-muted">Requests made through LifeForge on this device.</span>
        </div>
        {!ai.usage.tracking ? (
          <p className="mt-2 text-[13px] text-muted">Usage tracking is off.</p>
        ) : u && u.month.requests > 0 ? (
          <>
            <div className="mt-3">
              <PeriodTable rows={[['Today', u.today], ['Last 24h', u.last24h], ['This week', u.week], ['This month', u.month]]} />
            </div>
            <div className="num mt-3 grid grid-cols-2 gap-2 text-[13px]">
              <div className="rounded-2xl bg-surface-2 px-3 py-2">
                <div className="text-[11px] text-muted">Last minute</div>
                <b>{u.lastMinute.requests} requests</b> · {formatInt(u.lastMinute.totalTokens)} tok.
              </div>
              <div className="rounded-2xl bg-surface-2 px-3 py-2">
                <div className="text-[11px] text-muted">Current model</div>
                <b className="break-all">{u.lastModel || status?.model || '—'}</b>
              </div>
            </div>
            {u.today.missingTokens > 0 && <p className="mt-2 text-[11px] text-muted">{u.today.missingTokens} request(s) today had no token count from Gemini (e.g. errors).</p>}
            {(u.perDay !== undefined || u.foodShare !== undefined) && (
              <div className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px]">
                <div className="text-[11px] font-extrabold tracking-[0.14em] text-muted">ESTIMATE</div>
                {u.perDay !== undefined && <p>At your current usage rate, you are making approximately {u.perDay} AI requests/day.</p>}
                {u.foodShare !== undefined && <p>Food scans represent {u.foodShare}% of your Gemini requests.</p>}
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No Gemini requests yet.</p>
        )}
      </Card>

      {u?.quotaHit && (
        <Card className="mt-3 border border-danger/30">
          <div className="text-[11px] font-extrabold tracking-[0.14em] text-danger">GOOGLE AUTHORITATIVE · QUOTA ERROR</div>
          <p className="mt-1 text-[14px]">
            {u.limitReached ? 'Gemini is temporarily unavailable because a usage limit has been reached.' : 'Gemini reported a usage limit recently.'}
          </p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-muted">
            <li>When: {new Date(u.quotaHit.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</li>
            {u.quotaHit.limitType && <li>Limit: {LIMIT_LABEL[u.quotaHit.limitType] ?? u.quotaHit.limitType}</li>}
            {u.quotaHit.quotaValue !== undefined && <li>Limit value reported by Google: {formatInt(u.quotaHit.quotaValue)}</li>}
            {u.quotaHit.retryAt ? <li>Google says retry after: {new Date(u.quotaHit.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</li> : <li>{resetInfo(u.quotaHit.limitType ?? '')}</li>}
          </ul>
        </Card>
      )}

      {pressure && pressure.pct >= ai.usage.thresholds.notice && !u?.limitReached && (
        <Card className="mt-3">
          <div className="text-[14px] font-bold">You're approaching your estimated Gemini usage limit.</div>
          <p className="mt-1 text-[13px] text-muted">
            {pressure.model}: {LIMIT_LABEL[pressure.key]} at {pressure.pct}% of the known limit (~{formatInt(pressure.remaining)} left, app estimate). {resetInfo(pressure.key)} The router moves to another compatible Free Tier model when one is near its limit.
          </p>
        </Card>
      )}

      <ModelUsageSection />
      <details className="mt-2 rounded-2xl bg-surface px-4 py-1 shadow-card">
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold">Warning thresholds</summary>
        <div className="grid grid-cols-3 gap-2 pb-3">
          {(['notice', 'warning', 'critical'] as const).map((k) => (
            <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} %`}>
              <NumberInput value={ai.usage.thresholds[k]} min={1} max={100} onChange={(v) => void saveUsage({ thresholds: { ...ai.usage.thresholds, [k]: Math.min(100, Math.max(1, v)) } })} aria-label={`${k} threshold`} />
            </Field>
          ))}
        </div>
        <p className="pb-3 text-[11px] text-muted">🟢 Healthy · 🟡 High usage (≥{ai.usage.thresholds.notice}%) · 🟠 Near limit (≥{ai.usage.thresholds.critical}%) · 🔴 Rate limited · ⚫ Unavailable — percentages only against limits Google reported or you entered.</p>
      </details>

      <List title="Usage settings" footer="Food Vision requests can use more resources than short text requests. Long conversations and large context also use more tokens. LifeForge keeps prompts short, sends a compact context, caches repeated food requests and computes numbers locally to save quota.">
        <Row title="Enable usage tracking" subtitle="Timestamps, model, tokens, status — no message content" right={<Toggle checked={ai.usage.tracking} onChange={(v) => void saveUsage({ tracking: v })} label="Enable usage tracking" />} />
        <Row title="View official Gemini usage" subtitle="Google AI Studio → Dashboard → Usage (authoritative)" onClick={() => window.open(OFFICIAL_USAGE_URL, '_blank', 'noopener')} />
        <Row
          title="Clear local usage statistics"
          onClick={async () => {
            await clearUsage();
            setCleared('Usage statistics cleared.');
          }}
        />
      </List>

      <AdvancedRouter />

      {/* ——— Privacy ——— */}
      <Card className="mt-6">
        <div className="text-[16px] font-bold">Privacy</div>
        <div className="mt-2 rounded-2xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] font-extrabold tracking-[0.14em]">LOCAL DATA</div>
          <p className="text-[13px] text-muted">Your game, quests, logs, meals, settings, usage stats and the chat stay on this device (IndexedDB). Photos are not kept unless “Save Food Photos” is on.</p>
        </div>
        <div className="mt-2 rounded-2xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] font-extrabold tracking-[0.14em]">GEMINI AI</div>
          <p className="text-[13px] text-muted">When you use the AI Coach or Food Vision, your message, a short summary of your game (targets, today’s quests) and any photo you attach are sent through LifeForge’s serverless API to Google’s Gemini API. The API key stays on the server. LifeForge doesn’t store your photos or messages on the server. Google’s terms for the Gemini API apply (free-tier content may be used by Google to improve its products).</p>
        </div>
      </Card>
      <List title="AI history">
        <Row
          title="Clear AI history"
          subtitle="Forget what Gemini remembers of the conversation"
          onClick={async () => {
            await clearAiHistory(await loadChat());
            await clearChangeLog();
            setCleared('AI history cleared.');
          }}
        />
      </List>
      {cleared && <p className="mt-1.5 px-4 text-[12px] font-semibold text-success">{cleared}</p>}

      {/* ——— Setup guide ——— */}
      <Card className="mt-6">
        <div className="text-[16px] font-bold">How to connect Gemini</div>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[14px]">
          {STEPS.map((s, i) => (
            <li key={i} className={i === 2 ? 'font-semibold' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] text-muted">Free Tier limits can change and differ per model; Google AI Studio shows the current ones. If the quota runs out, LifeForge switches to the basic coach — nothing breaks.</p>
        <Button block variant="secondary" icon="external" className="mt-3" onClick={() => window.open('https://aistudio.google.com/', '_blank', 'noopener')}>
          Open Google AI Studio
        </Button>
      </Card>
    </div>
  );
}
