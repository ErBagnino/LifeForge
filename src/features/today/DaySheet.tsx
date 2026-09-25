import { useState } from 'react';
import { Field, Segmented, TimeInput, Toggle } from '@/components/ui/forms';
import { Button, Card } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { dayCapacity } from '@/domain/workload';
import { saveDayPlan, setDayType, setSickDay } from '@/services/game/dayService';
import { useGame } from '@/store/gameStore';
import type { DayType, TimeBlock } from '@/types';
import { formatDuration } from '@/utils/format';
import { Icon } from '@/components/ui/Icon';

/** Day status: workday / free / rest, sick day, work hours and busy blocks for today. */
export function DaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = useGame((s) => s.today);
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const [work, setWork] = useState<TimeBlock | undefined>(today?.plan.work);
  const [busy, setBusy] = useState<TimeBlock[]>(today?.plan.busy ?? []);
  if (!today || !settings) return null;
  const log = today.log;
  const cap = dayCapacity(today.plan);
  const info = DIFFICULTY_STATE_INFO[log?.difficultyState ?? 'balanced'];

  return (
    <Sheet open={open} onClose={onClose} title="Today’s setup">
      <Segmented<DayType>
        value={today.plan.dayType}
        onChange={(v) => void act(setDayType(today.date, v, settings))}
        options={[
          { value: 'work', label: '💼 Workday' },
          { value: 'free', label: '🌤️ Free day' },
          { value: 'rest', label: '🛌 Rest day' },
        ]}
      />
      <p className="mt-2 px-1 text-[12px] text-muted">
        Changing the day type rebuilds side quests. Rest day: training quests removed, essentials only, streak safe if the core is done.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Card>
          <div className="text-[12px] font-semibold text-muted">Workload</div>
          <div className="num text-[26px] font-extrabold">{log?.workload ?? 0}</div>
          <div className="text-[12px] text-muted capitalize">{log?.workloadLevel ?? 'medium'}</div>
        </Card>
        <Card>
          <div className="text-[12px] font-semibold text-muted">Game state</div>
          <div className="text-[18px] font-extrabold">
            {info.icon} {info.label}
          </div>
          <div className="text-[12px] text-muted">{info.description}</div>
        </Card>
      </div>
      <div className="mt-2 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">
        Awake {formatDuration(cap.awakeMin)} · work {formatDuration(cap.workMin)} · free {formatDuration(cap.freeMin)}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-3xl bg-surface px-4 py-3 shadow-card">
        <div>
          <div className="text-[16px] font-semibold">🤒 Sick day</div>
          <div className="text-[12px] text-muted">No penalties, streak protected.</div>
        </div>
        <Toggle checked={!!log?.sick} onChange={(v) => void act(setSickDay(today.date, v))} label="Sick day" />
      </div>

      {today.plan.dayType === 'work' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label="Work starts">
            <TimeInput value={work?.start ?? '09:00'} onChange={(v) => setWork({ start: v, end: work?.end ?? '18:00', label: 'Work' })} aria-label="Work start" />
          </Field>
          <Field label="Work ends">
            <TimeInput value={work?.end ?? '18:00'} onChange={(v) => setWork({ start: work?.start ?? '09:00', end: v, label: 'Work' })} aria-label="Work end" />
          </Field>
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[13px] font-semibold text-muted">Busy blocks today</span>
          <button type="button" className="text-[14px] font-semibold text-accent" onClick={() => setBusy((b) => [...b, { start: '12:00', end: '13:00', label: 'Busy' }])}>
            + Add
          </button>
        </div>
        {busy.map((b, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <TimeInput value={b.start} onChange={(v) => setBusy((all) => all.map((x, j) => (j === i ? { ...x, start: v } : x)))} aria-label="Busy start" />
            <TimeInput value={b.end} onChange={(v) => setBusy((all) => all.map((x, j) => (j === i ? { ...x, end: v } : x)))} aria-label="Busy end" />
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
          void act(saveDayPlan({ ...today.plan, work: today.plan.dayType === 'work' ? work : undefined, busy }));
          onClose();
        }}
      >
        Save & rebalance today
      </Button>
    </Sheet>
  );
}
