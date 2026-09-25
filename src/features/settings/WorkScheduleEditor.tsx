import { useState } from 'react';
import { Segmented, Select, TimeInput, Toggle } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, cx } from '@/components/ui/primitives';
import { blankWeek, describeEntry, WEEK_ORDER, WEEKDAY_NAMES, WEEKDAY_SHORT } from '@/domain/schedule';
import type { TimeHM, WorkDayEntry } from '@/types';

type Kind = WorkDayEntry['kind'];

const BREAKS = [0, 15, 30, 45, 60, 90].map((m) => ({ value: m, label: m ? `${m} min break` : 'No break' }));

/** A time that may be unknown: empty means "not sure yet". */
export function OptionalTime({ value, onChange, label, placeholder }: { value?: TimeHM; onChange: (v?: TimeHM) => void; label: string; placeholder?: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <TimeInput value={value ?? ''} onChange={(v) => onChange(v || undefined)} aria-label={label} className={cx('peer w-full', !value && 'text-transparent focus:text-fg')} />
      {!value && (
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center truncate pr-9 text-[15px] whitespace-nowrap text-muted peer-focus:hidden">
          {placeholder ?? `${label.split(' ').at(-1)} · not sure`}
        </span>
      )}
    </div>
  );
}

export interface WorkWeekValue {
  days: WorkDayEntry[];
  variable: boolean;
}

/**
 * Weekly work editor. Every field is optional: a day can be work / off / unknown,
 * and a work day can have only a start, only an end, or nothing at all.
 */
export function WorkScheduleEditor({ value, onChange }: { value: WorkWeekValue; onChange: (v: WorkWeekValue) => void }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [bulk, setBulk] = useState<{ start?: TimeHM; end?: TimeHM; breakMin: number }>({ breakMin: 0 });
  const days = value.days.length === 7 ? value.days : blankWeek();
  const setDay = (i: number, entry: WorkDayEntry) => onChange({ ...value, days: days.map((d, j) => (j === i ? entry : d)) });
  const toggle = (i: number) => setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));

  const applyBulk = () => {
    const entry: WorkDayEntry = { kind: 'work', start: bulk.start, end: bulk.end, breakMin: bulk.breakMin || undefined };
    onChange({ ...value, days: days.map((d, i) => (selected.includes(i) ? { ...entry } : d)) });
    setSelected([]);
  };

  return (
    <div>
      <Card className="!p-3">
        <div className="text-[13px] font-semibold text-muted">Same hours on…</div>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {WEEK_ORDER.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={selected.includes(i)}
              onClick={() => toggle(i)}
              className={cx('hit-44 h-11 min-w-0 rounded-xl text-[13px] font-bold', selected.includes(i) ? 'bg-accent text-on-accent' : 'bg-surface-2')}
            >
              {WEEKDAY_SHORT[i]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <OptionalTime value={bulk.start} onChange={(v) => setBulk({ ...bulk, start: v })} label="Work start" />
          <OptionalTime value={bulk.end} onChange={(v) => setBulk({ ...bulk, end: v })} label="Work end" />
        </div>
        <div className="mt-2 flex gap-2">
          <Select value={bulk.breakMin} onChange={(v) => setBulk({ ...bulk, breakMin: v })} options={BREAKS} aria-label="Break" className="min-w-0 flex-1" />
          <Button disabled={!selected.length} onClick={applyBulk} className="shrink-0">
            Apply
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted">Leave a time empty if you don’t know it yet — LifeForge only uses what you tell it.</p>
      </Card>

      <div className="mt-3 space-y-2">
        {WEEK_ORDER.map((i) => {
          const d = days[i];
          return (
            <Card key={i} className="!p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold">{WEEKDAY_NAMES[i]}</div>
                  <div className="truncate text-[12px] text-muted">{describeEntry(d)}</div>
                </div>
                <Segmented<Kind>
                  size="sm"
                  className="w-[168px] shrink-0"
                  value={d.kind}
                  onChange={(k) => setDay(i, k === 'work' ? { kind: 'work', ...(d.kind === 'work' ? d : {}) } : { kind: k })}
                  options={[
                    { value: 'work', label: 'Work' },
                    { value: 'off', label: 'Off' },
                    { value: 'unknown', label: '?' },
                  ]}
                />
              </div>
              {d.kind === 'work' && (
                <>
                  <div className="mt-2 flex gap-2">
                    <OptionalTime value={d.start} onChange={(v) => setDay(i, { ...d, start: v })} label={`${WEEKDAY_SHORT[i]} start`} />
                    <OptionalTime value={d.end} onChange={(v) => setDay(i, { ...d, end: v })} label={`${WEEKDAY_SHORT[i]} end`} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Select value={d.breakMin ?? 0} onChange={(v) => setDay(i, { ...d, breakMin: v || undefined })} options={BREAKS} aria-label={`${WEEKDAY_NAMES[i]} break`} className="min-w-0 flex-1" />
                    <button
                      type="button"
                      aria-pressed={!!d.approximate}
                      onClick={() => setDay(i, { ...d, approximate: !d.approximate })}
                      className={cx('flex h-12 shrink-0 items-center gap-1 rounded-2xl px-3 text-[13px] font-semibold', d.approximate ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-muted')}
                    >
                      <Icon name={d.approximate ? 'check' : 'plus'} size={14} /> Approx.
                    </button>
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mt-3 !p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Hours change week to week</div>
            <div className="text-[12px] text-muted">Shifts or variable hours: LifeForge will ask day by day instead of guessing.</div>
          </div>
          <Toggle checked={value.variable} onChange={(v) => onChange({ ...value, variable: v })} label="Variable hours" />
        </div>
      </Card>
    </div>
  );
}
