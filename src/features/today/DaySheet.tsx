import { useState } from 'react';
import { Segmented, TimeInput, Toggle } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { activeExceptions, describeWork, loadModeFor, workFromPlan } from '@/domain/schedule';
import { useAsync } from '@/hooks';
import { saveDayPlan, setDayType, setSickDay } from '@/services/game/dayService';
import { addException, clearTemporaryWork, previewRebalance, removeException, setTemporaryWork } from '@/services/scheduleService';
import { useGame } from '@/store/gameStore';
import type { LoadMode, TimeBlock, TimeHM } from '@/types';
import { formatDuration } from '@/utils/format';
import { OptionalTime } from '../settings/WorkScheduleEditor';

type WorkChoice = 'work' | 'off' | 'unknown';

/** Today's setup: what we know about work today, rest/sick day, busy blocks and how to treat a full day. */
export function DaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = useGame((s) => s.today);
  const settings = useGame((s) => s.settings);
  const version = useGame((s) => s.version);
  const act = useGame((s) => s.act);
  const plan = today?.plan;
  const w = plan ? workFromPlan(plan) : undefined;
  const [times, setTimes] = useState<{ start?: TimeHM; end?: TimeHM }>({ start: w?.start, end: w?.end });
  const [busy, setBusy] = useState<TimeBlock[]>(plan?.busy ?? []);
  const { data: preview } = useAsync(async () => (open && settings ? previewRebalance(settings) : undefined), [open, version]);
  if (!today || !settings || !plan || !w) return null;
  const log = today.log;
  const info = DIFFICULTY_STATE_INFO[log?.difficultyState ?? 'balanced'];
  const choice: WorkChoice = w.status === 'off' ? 'off' : w.status === 'unknown' ? 'unknown' : 'work';
  const mode = loadModeFor(settings, today.date);
  const todays = activeExceptions(settings.exceptions, today.date).filter((e) => (e.kind === 'push' || e.kind === 'keep_all') && e.from === today.date && e.to === today.date);

  const setChoice = (c: WorkChoice) => {
    if (c === 'off') void act(setTemporaryWork(today.date, { kind: 'off' }));
    else if (c === 'unknown') void act(setTemporaryWork(today.date, { kind: 'unknown' }));
    else void act(setTemporaryWork(today.date, { kind: 'work', start: times.start, end: times.end }));
  };

  const setMode = async (m: LoadMode) => {
    for (const e of todays) await act(removeException(e.id));
    if (m !== settings.load.mode && m !== 'auto') await act(addException({ kind: m, from: today.date, to: today.date, note: 'Today only' }));
  };

  return (
    <Sheet open={open} onClose={onClose} title="Today’s setup">
      <Card className="!p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-bold">💼 Work today</div>
          <Chip>{describeWork(w)}</Chip>
        </div>
        <Segmented<WorkChoice>
          className="mt-3"
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'work', label: 'Working' },
            { value: 'off', label: 'Day off' },
            { value: 'unknown', label: 'Not sure' },
          ]}
        />
        {choice === 'work' && (
          <>
            <div className="mt-2 flex gap-2">
              <OptionalTime value={times.start} onChange={(v) => setTimes({ ...times, start: v })} label="Work start" />
              <OptionalTime value={times.end} onChange={(v) => setTimes({ ...times, end: v })} label="Work end" />
            </div>
            <Button block variant="tinted" className="mt-2" onClick={() => void act(setTemporaryWork(today.date, { kind: 'work', start: times.start, end: times.end }))}>
              Use these hours today
            </Button>
          </>
        )}
        <p className="mt-2 text-[12px] text-muted">
          {plan.temporary ? 'Today only — your regular week is unchanged.' : w.source === 'none' ? 'No work schedule yet. That’s fine: the plan adapts to what you actually do.' : 'From your regular week.'}
        </p>
        {plan.temporary && (
          <button type="button" className="mt-1 h-11 text-[14px] font-semibold text-accent" onClick={() => void act(clearTemporaryWork(today.date))}>
            Back to my regular week
          </button>
        )}
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Card className="!p-3">
          <div className="text-[12px] font-semibold text-muted">Daily capacity</div>
          <div className="num text-[24px] font-extrabold">{formatDuration(preview?.after.capacity ?? log?.capacityMin ?? 0)}</div>
          <div className="text-[12px] text-muted">
            Load {log?.workload ?? 0} · <span className="capitalize">{log?.workloadLevel ?? 'medium'}</span>
          </div>
        </Card>
        <Card className="!p-3">
          <div className="text-[12px] font-semibold text-muted">Game state</div>
          <div className="text-[17px] font-extrabold">
            {info.icon} {info.label}
          </div>
          <div className="text-[12px] text-muted">{info.description}</div>
        </Card>
      </div>
      {!!preview?.reasons.length && (
        <ul className="mt-2 space-y-1 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">
          {preview.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}

      <Card className="mt-3 !p-3">
        <div className="text-[15px] font-bold">If today gets full</div>
        <Segmented<LoadMode>
          className="mt-2"
          value={mode}
          onChange={(m) => void setMode(m)}
          options={[
            { value: 'auto', label: 'Balance' },
            { value: 'keep_all', label: 'Keep all' },
            { value: 'push', label: 'Push' },
          ]}
        />
        <p className="mt-2 text-[12px] text-muted">Core quests are never trimmed. Balance turns extra work into a no-pressure bonus; Keep all and Push leave everything as it is.</p>
      </Card>

      <div className="mt-3 divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">🛌 Rest day</div>
            <div className="text-[12px] text-muted">Training removed, essentials only.</div>
          </div>
          <Toggle checked={plan.dayType === 'rest'} onChange={(v) => void act(setDayType(today.date, v ? 'rest' : w.status === 'set' || w.status === 'partial' ? 'work' : 'free', settings))} label="Rest day" />
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">🤒 Sick day</div>
            <div className="text-[12px] text-muted">No penalties, streak protected.</div>
          </div>
          <Toggle checked={!!log?.sick} onChange={(v) => void act(setSickDay(today.date, v))} label="Sick day" />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[13px] font-semibold text-muted">Busy blocks today</span>
          <button type="button" className="h-11 px-2 text-[14px] font-semibold text-accent" onClick={() => setBusy((b) => [...b, { start: '12:00', end: '13:00', label: 'Busy' }])}>
            + Add
          </button>
        </div>
        {busy.map((b, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <TimeInput value={b.start} onChange={(v) => setBusy((all) => all.map((x, j) => (j === i ? { ...x, start: v } : x)))} aria-label="Busy start" className="min-w-0 flex-1" />
            <TimeInput value={b.end} onChange={(v) => setBusy((all) => all.map((x, j) => (j === i ? { ...x, end: v } : x)))} aria-label="Busy end" className="min-w-0 flex-1" />
            <button type="button" aria-label="Remove block" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted" onClick={() => setBusy((all) => all.filter((_, j) => j !== i))}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        {!busy.length && <div className="rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">No extra commitments today.</div>}
      </div>
      <Button
        block
        size="lg"
        className="mt-4"
        onClick={() => {
          void act(saveDayPlan({ ...plan, busy }));
          onClose();
        }}
      >
        Save & rebalance today
      </Button>
    </Sheet>
  );
}
