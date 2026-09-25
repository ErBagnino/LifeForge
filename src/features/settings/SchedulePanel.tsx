import { useState } from 'react';
import { List, Row, Segmented, TimeInput, Toggle } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Chip, cx, SectionTitle } from '@/components/ui/primitives';
import { activeSchedule, blankWeek, describeWork, summarizeSchedule, upcomingSchedules, WEEK_ORDER, WEEKDAY_NAMES, WEEKDAY_SHORT } from '@/domain/schedule';
import { useAsync } from '@/hooks';
import { saveSettings } from '@/services/adminService';
import { clock } from '@/services/clock';
import { workFromPlan } from '@/domain/schedule';
import {
  addWorkSchedule,
  clearTemporaryWork,
  currentExceptions,
  newSchedule,
  removeException,
  removeWorkSchedule,
  setLoadMode,
  setTemporaryWork,
  setWorkUnknown,
  upcomingTemporary,
} from '@/services/scheduleService';
import { rebuildDay } from '@/services/game/dayService';
import { useGame } from '@/store/gameStore';
import type { AvailabilityException, ISODate, LoadMode, Settings, TimeHM, WorkDayEntry } from '@/types';
import { formatDate, shiftDate, weekday } from '@/utils/date';
import { OptionalTime, WorkScheduleEditor, type WorkWeekValue } from './WorkScheduleEditor';

const EXCEPTION_LABEL: Record<AvailabilityException['kind'], string> = {
  no_gym: '🚫🏋️ No gym',
  more_time: '⏳ More free time',
  less_time: '⌛ Less free time',
  keep_all: '🔒 Keep every quest',
  push: '🔥 Push mode',
};

export function rangeLabel(from: ISODate, to?: ISODate): string {
  if (!to) return `from ${formatDate(from, 'EEE d MMM')}`;
  if (from === to) return formatDate(from, 'EEE d MMM');
  return `${formatDate(from, 'd MMM')} – ${formatDate(to, 'd MMM')}`;
}

function nextMonday(today: ISODate): ISODate {
  const wd = weekday(today);
  return shiftDate(today, wd === 1 ? 7 : (8 - wd) % 7 || 7);
}

export function SchedulePanel() {
  const settings = useGame((s) => s.settings)!;
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  const today = clock.today();
  const version = useGame((s) => s.version);
  const [editing, setEditing] = useState<WorkWeekValue | null>(null);
  const [from, setFrom] = useState<'today' | 'monday' | 'date'>('today');
  const [fromDate, setFromDate] = useState<ISODate>(today);
  const [oneOff, setOneOff] = useState<{ date: ISODate; kind: 'work' | 'off'; start?: TimeHM; end?: TimeHM } | null>(null);
  const { data: temps } = useAsync(() => upcomingTemporary(today, 45), [today, version]);

  const active = activeSchedule(settings.work, today);
  const upcoming = upcomingSchedules(settings.work, today);
  const exceptions = currentExceptions(settings, today);

  const startEditing = () => {
    setEditing({ days: active ? structuredClone(active.days) : blankWeek(), variable: !!active?.variable });
    setFrom('today');
  };

  const save = async () => {
    if (!editing) return;
    const effectiveFrom = from === 'today' ? today : from === 'monday' ? nextMonday(today) : fromDate;
    await act(addWorkSchedule(newSchedule(editing.days, effectiveFrom, 'settings', { variable: editing.variable })));
    setEditing(null);
  };

  const saveSettingsAndRebuild = async (patch: Partial<Settings>) => {
    await saveSettings({ ...settings, ...patch });
    await act(rebuildDay(today));
    await refresh();
  };

  return (
    <div className="mt-3">
      {/* ——— Work ——— */}
      <SectionTitle className="!mt-2">Work schedule</SectionTitle>
      {editing ? (
        <>
          <WorkScheduleEditor value={editing} onChange={setEditing} />
          <Card className="mt-3 !p-3">
            <div className="text-[13px] font-semibold text-muted">Starts</div>
            <Segmented
              className="mt-2"
              value={from}
              onChange={setFrom}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'monday', label: 'Next Monday' },
                { value: 'date', label: 'Pick date' },
              ]}
            />
            {from === 'date' && (
              <input type="date" value={fromDate} min={today} onChange={(e) => setFromDate(e.target.value || today)} className="mt-2 h-12 w-full rounded-2xl bg-surface-2 px-4 text-[16px]" aria-label="Start date" />
            )}
          </Card>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button className="flex-[2]" onClick={() => void save()}>
              Save schedule
            </Button>
          </div>
        </>
      ) : settings.work.status !== 'set' || !active ? (
        <Card>
          <div className="flex items-start gap-3">
            <span className="text-[28px]">💼</span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold">{settings.work.status === 'unknown' ? 'You don’t know yet — no problem.' : 'Not configured yet.'}</div>
              <p className="mt-0.5 text-[14px] text-muted">I’ll work with what I know. Quests adapt to your energy and to what you actually get done. Add hours whenever you have them.</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" icon="plus" onClick={startEditing}>
              Add schedule
            </Button>
            {settings.work.status !== 'unknown' && (
              <Button variant="secondary" className="flex-1" onClick={() => void act(setWorkUnknown())}>
                I don’t know yet
              </Button>
            )}
          </div>
          {upcoming.length > 0 && <p className="mt-2 text-[12px] text-muted">A schedule starts {formatDate(upcoming[0].effectiveFrom, 'EEE d MMM')} (see below).</p>}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <Chip icon="✅">Set{active.variable ? ' · variable' : ''}</Chip>
            <span className="text-[12px] text-muted">{active.effectiveFrom > '2000-01-01' ? `since ${formatDate(active.effectiveFrom, 'd MMM')}` : ''}</span>
          </div>
          <ul className="mt-2 space-y-1">
            {summarizeSchedule(active.days).map((l) => (
              <li key={l} className="num text-[15px] font-semibold">
                {l}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" icon="edit" onClick={startEditing}>
              Change
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => void act(setWorkUnknown())}>
              Not sure
            </Button>
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <List title="Upcoming changes">
          {upcoming.map((u) => (
            <Row
              key={u.id}
              icon="🗓️"
              title={`From ${formatDate(u.effectiveFrom, 'EEE d MMM')}`}
              subtitle={summarizeSchedule(u.days).join(' · ')}
              right={
                <button type="button" aria-label="Remove upcoming schedule" className="flex h-11 w-11 items-center justify-center rounded-full text-muted" onClick={() => void act(removeWorkSchedule(u.id))}>
                  <Icon name="trash" size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}

      {/* ——— One-off days ——— */}
      <SectionTitle>One-off days</SectionTitle>
      <p className="-mt-1 mb-2 px-1 text-[13px] text-muted">“Tomorrow I work 10–20” — changes that day only, your regular week stays the same.</p>
      {!!temps?.length && (
        <List className="!mt-0">
          {temps.map((p) => (
            <Row
              key={p.date}
              icon={p.workStatus === 'off' ? '🌤️' : '💼'}
              title={formatDate(p.date, 'EEE d MMM')}
              subtitle={describeWork(workFromPlan(p))}
              right={
                <button type="button" aria-label="Remove one-off day" className="flex h-11 w-11 items-center justify-center rounded-full text-muted" onClick={() => void act(clearTemporaryWork(p.date))}>
                  <Icon name="trash" size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}
      {oneOff ? (
        <Card className="mt-2 !p-3">
          <div className="flex gap-2">
            <input type="date" value={oneOff.date} min={today} onChange={(e) => setOneOff({ ...oneOff, date: e.target.value || today })} className="h-12 min-w-0 flex-1 rounded-2xl bg-surface-2 px-3 text-[16px]" aria-label="Date" />
            <Segmented
              className="w-[140px] shrink-0"
              value={oneOff.kind}
              onChange={(k) => setOneOff({ ...oneOff, kind: k })}
              options={[
                { value: 'work', label: 'Work' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>
          {oneOff.kind === 'work' && (
            <div className="mt-2 flex gap-2">
              <OptionalTime value={oneOff.start} onChange={(v) => setOneOff({ ...oneOff, start: v })} label="Day start" />
              <OptionalTime value={oneOff.end} onChange={(v) => setOneOff({ ...oneOff, end: v })} label="Day end" />
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setOneOff(null)}>
              Cancel
            </Button>
            <Button
              className="flex-[2]"
              onClick={async () => {
                const entry: WorkDayEntry = oneOff.kind === 'off' ? { kind: 'off' } : { kind: 'work', start: oneOff.start, end: oneOff.end };
                await act(setTemporaryWork(oneOff.date, entry));
                setOneOff(null);
              }}
            >
              Save day
            </Button>
          </div>
        </Card>
      ) : (
        <Button block variant="tinted" icon="plus" className="mt-2" onClick={() => setOneOff({ date: shiftDate(today, 1), kind: 'work' })}>
          Add a one-off day
        </Button>
      )}

      {exceptions.length > 0 && (
        <List title="Availability">
          {exceptions.map((e) => (
            <Row
              key={e.id}
              title={EXCEPTION_LABEL[e.kind]}
              subtitle={`${rangeLabel(e.from, e.to)}${e.note ? ` · ${e.note}` : ''}`}
              right={
                <button type="button" aria-label="Remove" className="flex h-11 w-11 items-center justify-center rounded-full text-muted" onClick={() => void act(removeException(e.id))}>
                  <Icon name="trash" size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}

      {/* ——— Rhythm ——— */}
      <SectionTitle>Daily rhythm</SectionTitle>
      <Card className="!p-3">
        <RhythmRow
          label="Wake up"
          value={settings.known.wake === 'set' ? settings.schedule.wake : undefined}
          estimate={settings.schedule.wake}
          status={settings.known.wake}
          onChange={(v) =>
            void saveSettingsAndRebuild(
              v ? { schedule: { ...settings.schedule, wake: v }, known: { ...settings.known, wake: 'set' } } : { known: { ...settings.known, wake: 'unknown' } },
            )
          }
        />
        <div className="my-3 h-px bg-line" />
        <RhythmRow
          label="Bedtime"
          value={settings.known.sleep === 'set' ? settings.schedule.sleep : undefined}
          estimate={settings.schedule.sleep}
          status={settings.known.sleep}
          onChange={(v) =>
            void saveSettingsAndRebuild(
              v ? { schedule: { ...settings.schedule, sleep: v }, known: { ...settings.known, sleep: 'set' } } : { known: { ...settings.known, sleep: 'unknown' } },
            )
          }
        />
      </Card>

      {/* ——— Training ——— */}
      <SectionTitle>Workout availability</SectionTitle>
      <Card className="!p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Not sure yet</div>
            <div className="text-[12px] text-muted">Flexible plan: one session whenever a day allows it, 3 per week.</div>
          </div>
          <Toggle
            checked={settings.known.training === 'unknown'}
            onChange={(v) => void saveSettingsAndRebuild({ known: { ...settings.known, training: v ? 'unknown' : 'set' } })}
            label="Workout availability not sure yet"
          />
        </div>
        {settings.known.training !== 'unknown' && (
          <div className="mt-3 grid grid-cols-7 gap-1">
            {WEEK_ORDER.map((i) => {
              const on = settings.schedule.days[i]?.trainingAvailable ?? true;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${WEEKDAY_NAMES[i]} training ${on ? 'available' : 'unavailable'}`}
                  onClick={() => void saveSettingsAndRebuild({ schedule: { ...settings.schedule, days: settings.schedule.days.map((d, j) => (j === i ? { ...d, trainingAvailable: !on } : d)) } })}
                  className={cx('hit-44 h-11 min-w-0 rounded-xl text-[13px] font-bold', on ? 'bg-success/15 text-success' : 'bg-surface-2 text-faint')}
                >
                  {WEEKDAY_SHORT[i]}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* ——— Load ——— */}
      <SectionTitle>When a day is full</SectionTitle>
      <Card className="!p-3">
        <Segmented<LoadMode>
          value={settings.load.mode}
          onChange={(m) => void act(setLoadMode(m))}
          options={[
            { value: 'auto', label: 'Balance' },
            { value: 'keep_all', label: 'Keep all' },
            { value: 'push', label: 'Push' },
          ]}
        />
        <p className="mt-2 text-[13px] text-muted">
          {settings.load.mode === 'auto'
            ? 'Core quests always stay. On full days, optional work becomes a no-pressure bonus. You can keep any quest with one tap.'
            : settings.load.mode === 'keep_all'
              ? 'Nothing gets trimmed — your call. The coach may still warn you on very heavy days.'
              : 'Nothing gets trimmed and extra side quests are offered. Safety limits still apply.'}
        </p>
      </Card>
      <BusyBlocks />
    </div>
  );
}

function RhythmRow({ label, value, estimate, status, onChange }: { label: string; value?: TimeHM; estimate: TimeHM; status: string; onChange: (v?: TimeHM) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="text-[12px] text-muted">{status === 'set' ? 'Set' : status === 'unknown' ? `Not sure yet · planning with ~${estimate}` : `Not set · planning with ~${estimate}`}</div>
      </div>
      <div className="w-[128px] shrink-0">
        <OptionalTime value={value} onChange={onChange} label={`${label} time`} placeholder="Not sure" />
      </div>
    </div>
  );
}

function BusyBlocks() {
  const settings = useGame((s) => s.settings)!;
  const refresh = useGame((s) => s.refresh);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(settings.schedule.days);
  const setBusy = (i: number, busy: Settings['schedule']['days'][number]['busy']) => setDays(days.map((d, j) => (j === i ? { ...d, busy } : d)));
  return (
    <>
      <SectionTitle
        action={
          <button type="button" className="h-11 px-2 text-[14px] font-semibold text-accent" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide' : 'Edit'}
          </button>
        }
      >
        Recurring busy blocks
      </SectionTitle>
      {!open ? (
        <p className="-mt-1 px-1 text-[13px] text-muted">{days.some((d) => d.busy.length) ? `${days.reduce((s, d) => s + d.busy.length, 0)} blocks (classes, commute…)` : 'None — add classes, commute or anything that repeats.'}</p>
      ) : (
        <div className="space-y-2">
          {WEEK_ORDER.map((i) => (
            <Card key={i} className="!p-3">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold">{WEEKDAY_NAMES[i]}</span>
                <button type="button" className="h-11 px-2 text-[13px] font-semibold text-accent" onClick={() => setBusy(i, [...days[i].busy, { start: '18:00', end: '19:00', label: 'Busy' }])}>
                  + Block
                </button>
              </div>
              {days[i].busy.map((b, bi) => (
                <div key={bi} className="mt-2 flex items-center gap-2">
                  <TimeInput value={b.start} onChange={(v) => setBusy(i, days[i].busy.map((x, k) => (k === bi ? { ...x, start: v } : x)))} aria-label="Busy start" className="min-w-0 flex-1" />
                  <TimeInput value={b.end} onChange={(v) => setBusy(i, days[i].busy.map((x, k) => (k === bi ? { ...x, end: v } : x)))} aria-label="Busy end" className="min-w-0 flex-1" />
                  <button type="button" aria-label="Remove busy block" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2" onClick={() => setBusy(i, days[i].busy.filter((_, k) => k !== bi))}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </Card>
          ))}
          <Button
            block
            size="lg"
            onClick={async () => {
              await saveSettings({ ...settings, schedule: { ...settings.schedule, days } });
              await refresh();
              setOpen(false);
            }}
          >
            Save busy blocks
          </Button>
        </div>
      )}
    </>
  );
}
