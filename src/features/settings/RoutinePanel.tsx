import { useState } from 'react';
import { List, Row, TimeInput, Toggle } from '@/components/ui/forms';
import { Button, Card } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Sheet';
import { formatDuration, hm, type MinuteStat } from '@/domain/dailyContext';
import { useAsync } from '@/hooks';
import { saveSettings } from '@/services/adminService';
import { clock } from '@/services/clock';
import { confirmWake, editWorkSession, getDayContext, learnedSchedule, resetLearnedSchedule, workHistory } from '@/services/contextService';
import { rebuildDay } from '@/services/game/dayService';
import { useGame } from '@/store/gameStore';
import type { Settings } from '@/types';
import { dateTimeToTs, formatDate, tsToHm } from '@/utils/date';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const learnedText = (s?: MinuteStat) => (s ? `≈ ${hm(s.median)} (${s.count}×)` : 'Not enough data yet');

/** Settings → Daily Routine: manual times, what LifeForge learned, adaptive schedule, reset. */
export function RoutinePanel() {
  const settings = useGame((s) => s.settings)!;
  const context = useGame((s) => s.context);
  const refresh = useGame((s) => s.refresh);
  const version = useGame((s) => s.version);
  const { data: learned } = useAsync(() => learnedSchedule(), [version, settings.routine.adaptive, settings.routine.learnedSince]);
  const { data: work } = useAsync(() => workHistory(30), [version]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ date: string; index: number; start: string; end: string } | null>(null);

  const save = async (patch: Partial<Settings>) => {
    await saveSettings({ ...settings, ...patch });
    await refresh();
  };
  const saveRoutine = (patch: Partial<Settings['routine']>) => save({ routine: { ...settings.routine, ...patch } });
  const wakeToday = context?.ctx.wakeUpTime;

  return (
    <div className="mt-3">
      <List title="Wake-up & sleep" footer="Manual times are always used for planning. With Adaptive schedule on, LifeForge also learns your real rhythm and only ever proposes changes.">
        <Row
          title="Planned wake-up"
          right={
            <TimeInput
              value={settings.schedule.wake}
              onChange={(v) => void save({ schedule: { ...settings.schedule, wake: v }, known: { ...settings.known, wake: 'set' } }).then(() => rebuildDay(clock.today()))}
              aria-label="Planned wake-up"
              className="!h-11 w-[120px]"
            />
          }
        />
        <Row
          title="Bedtime"
          right={
            <TimeInput
              value={settings.schedule.sleep}
              onChange={(v) => void save({ schedule: { ...settings.schedule, sleep: v }, known: { ...settings.known, sleep: 'set' } }).then(() => rebuildDay(clock.today()))}
              aria-label="Bedtime"
              className="!h-11 w-[120px]"
            />
          }
        />
        <Row
          title="Woke up today"
          subtitle={wakeToday ? `${tsToHm(wakeToday)} · ${context?.ctx.wakeSource ?? ''}` : 'Not recorded'}
          right={<TimeInput value={wakeToday ? tsToHm(wakeToday) : ''} onChange={(v) => v && void confirmWake(dateTimeToTs(clock.today(), v, settings.dayStartHour), 'manual').then(refresh)} aria-label="Set wake-up time manually" className="!h-11 w-[120px]" />}
        />
        <Row title="Typical wake-up (weekdays)" subtitle={learnedText(learned?.wake.weekday)} />
        <Row title="Typical wake-up (weekend)" subtitle={learnedText(learned?.wake.weekend)} />
        <Row title="Ask “Did you just wake up?”" subtitle="On the first morning open" right={<Toggle checked={settings.routine.askWake} onChange={(v) => void saveRoutine({ askWake: v })} label="Ask about wake-up" />} />
      </List>

      <List title="Work" footer="Work is only what you log with START / END WORK (START = leaving home, so the commute counts). No location is used. Not working one day? Just don’t start a session.">
        <Row title="Usual workdays" subtitle={learned?.work.workdays.length ? learned.work.workdays.map((d) => WD[d]).join(', ') : 'Learning (needs 3+ sessions per weekday)'} />
        <Row title="Average start" subtitle={work?.avgStartMin !== undefined ? hm(work.avgStartMin) : '—'} />
        <Row title="Average end" subtitle={work?.avgEndMin !== undefined ? hm(work.avgEndMin) : '—'} />
        <Row title="Average duration (incl. commute)" subtitle={work?.avgMinutes !== undefined ? formatDuration(work.avgMinutes) : '—'} />
      </List>
      {!!work?.rows.length && (
        <Card className="mt-2 !p-3">
          <div className="text-[13px] font-semibold text-muted">Recent work sessions</div>
          <ul className="mt-1 divide-y divide-line">
            {work.rows.slice(0, 7).map((r) => (
              <li key={r.start} className="flex min-h-11 items-center gap-2 py-1.5 text-[14px]">
                <span className="num min-w-0 flex-1 truncate">
                  {formatDate(r.date, 'EEE d MMM')} · {tsToHm(r.start)}–{tsToHm(r.end)} · {formatDuration(r.minutes)}
                  {r.edited ? ' ✎' : ''}
                </span>
                <button
                  type="button"
                  className="hit-44 shrink-0 text-[13px] font-semibold text-accent"
                  onClick={async () => {
                    const c = await getDayContext(r.date);
                    setEditing({ date: r.date, index: c.work.findIndex((w) => w.start === r.start), start: tsToHm(r.start), end: tsToHm(r.end) });
                  }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
          {editing && (
            <div className="mt-2 rounded-2xl bg-surface-2 p-3">
              <div className="text-[13px] font-semibold">{formatDate(editing.date, 'EEE d MMM')}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <TimeInput value={editing.start} onChange={(v) => setEditing({ ...editing, start: v })} aria-label="Work start" />
                <TimeInput value={editing.end} onChange={(v) => setEditing({ ...editing, end: v })} aria-label="Work end" />
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={async () => {
                    const start = dateTimeToTs(editing.date, editing.start, settings.dayStartHour);
                    const end = dateTimeToTs(editing.date, editing.end, settings.dayStartHour);
                    if (end > start) {
                      await editWorkSession(editing.date, editing.index, start, end);
                      setEditing(null);
                      await refresh();
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <List title="Learned habits">
        <Row title="Typical workout time" subtitle={learnedText(learned?.workout)} />
        <Row title="Breakfast" subtitle={learnedText(learned?.meals.breakfast)} />
        <Row title="Lunch" subtitle={learnedText(learned?.meals.lunch)} />
        <Row title="Dinner" subtitle={learnedText(learned?.meals.dinner)} />
      </List>

      <List title="Adaptive schedule" footer="LifeForge learns only after 3–5 real events and never moves important times by itself: it asks with a YES / NO card on Home (e.g. “Move workout reminder to 19:00?”). Everything stays on this device.">
        <Row title="Adaptive schedule" subtitle={settings.routine.adaptive ? 'On — learning from your real days' : 'Off — manual times only'} right={<Toggle checked={settings.routine.adaptive} onChange={(v) => void saveRoutine({ adaptive: v })} label="Adaptive schedule" />} />
        <Row title="Reset learned schedule" subtitle={settings.routine.learnedSince ? `Learning since ${formatDate(new Date(settings.routine.learnedSince).toISOString().slice(0, 10), 'd MMM')}` : 'Forget learned patterns only'} onClick={() => setConfirmReset(true)} />
      </List>
      {done && <p className="mt-1.5 px-4 text-[12px] font-semibold text-success">{done}</p>}

      <Dialog
        open={confirmReset}
        title="Reset learned schedule?"
        message="LifeForge forgets the wake-up, work, meal and activity-time patterns it learned and starts learning again from today. Your progress, quests, achievements, work history and all game data are kept."
        confirmLabel="Reset patterns"
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          await resetLearnedSchedule();
          await refresh();
          setDone('Learned schedule reset. Nothing else was deleted.');
        }}
      />
    </div>
  );
}
