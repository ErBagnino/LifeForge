import { learnTimes, reminderMinute } from '@/domain/habits';
import { applyQuietWindows, governReminders, planReminders, type PlannedReminder, type QuietWindow } from '@/domain/reminders';
import { expectedWork } from '@/domain/dailyContext';
import { getOpenWork, learnedSchedule } from '../contextService';
import { type LeisureTimer } from '@/domain/leisure';
import {
  metaRepository,
  notificationRepository,
  playerRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  workoutRepository,
} from '@/repositories';
import { hmToMinutes, isWeekend, minuteOfDay, shiftDate } from '@/utils/date';
import { uid } from '@/utils/id';
import { clock } from '../clock';
import { planFor } from '../game/dayPlan';
import { notificationService } from './NotificationService';

const LEAD: Record<string, number> = { workout: 30 };
let timers: ReturnType<typeof setTimeout>[] = [];
let planning: Promise<PlannedReminder[]> | null = null;

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

async function leisureReminders(now: number): Promise<PlannedReminder[]> {
  const settings = await settingsRepository.get();
  const timer = await metaRepository.get<LeisureTimer>('leisureTimer');
  if (!settings?.leisure.enabled || !timer || !settings.notifications.types.leisure) return [];
  const log = await statsRepository.getLog(clock.today());
  const used = log?.metrics.leisure ?? 0;
  const limit = settings.leisure.dailyLimitMin;
  const warnAt = (limit * settings.leisure.warnAtPct) / 100;
  const out: PlannedReminder[] = [];
  const at = (minutes: number) => timer.startedAt + (minutes - used) * 60000;
  if (used < warnAt) {
    out.push({ type: 'leisure', at: at(warnAt), title: '🎮 Play time check', body: `${Math.round(limit - warnAt)} minutes of play time left today.`, tag: `leisure:warn:${timer.startedAt}`, priority: 95 });
  }
  if (used < limit) {
    out.push({ type: 'leisure', at: at(limit), title: '⛔ Play-time budget reached', body: 'That was today’s budget. Stop the timer and go win something real.', tag: `leisure:limit:${timer.startedAt}`, priority: 99 });
  }
  return out.filter((r) => r.at > now);
}

/** Compute today's governed reminder plan. */
export async function planToday(): Promise<PlannedReminder[]> {
  const [settings, player] = await Promise.all([settingsRepository.get(), playerRepository.get()]);
  if (!settings || !player || !settings.notifications.enabled) return [];
  const today = clock.today();
  const now = clock.now();
  const [quests, log, plan, history] = await Promise.all([
    questRepository.byDate(today),
    statsRepository.getLog(today),
    planFor(today, settings),
    questRepository.byRange(shiftDate(today, -45), shiftDate(today, -1)),
  ]);
  const since = settings.routine.learnedSince ?? 0;
  const learned = learnTimes(
    history
      .filter((q) => settings.routine.adaptive && q.status === 'completed' && q.activityId && q.completedAt && q.completedAt >= since)
      .map((q) => ({ activityId: q.activityId!, minute: q.actualTime ? hmToMinutes(q.actualTime) : minuteOfDay(q.completedAt!), weekend: isWeekend(q.date) })),
  );
  const learnedMinute: Record<string, number> = {};
  for (const l of learned) {
    const m = reminderMinute(l, undefined, LEAD[l.activityId] ?? 10);
    if (m !== undefined) learnedMinute[l.activityId] = m;
  }
  const threshold = settings.rules.difficultyPresets[settings.difficulty].streakThreshold;
  const planned = planReminders({
    date: today,
    now,
    dayStartHour: settings.dayStartHour,
    settings: settings.notifications,
    wake: plan.wake,
    sleep: plan.sleep,
    quests,
    learnedMinute,
    water: { current: log?.metrics.water ?? 0, target: settings.hydration.targetMl },
    streakAtRisk: player.streak.current > 0 && (log?.score ?? 0) < threshold,
    streak: player.streak.current,
  });
  planned.push(...(await leisureReminders(now)));
  // Respect the daily context: no nudges at work, during a workout, or while playing.
  const windows: QuietWindow[] = [];
  const work = await getOpenWork();
  if (work) {
    const learned = await learnedSchedule();
    const typical = expectedWork(learned, today)?.minutes ?? learned.work.avgMinutes ?? 9 * 60;
    windows.push({ from: work.start, to: Math.max(now + 30 * 60_000, work.start + typical * 60_000), reason: 'work' });
  }
  if (await workoutRepository.activeSession()) windows.push({ from: now, to: now + 120 * 60_000, reason: 'training' });
  if (await metaRepository.get<LeisureTimer>('leisureTimer')) windows.push({ from: now, to: now + 60 * 60_000, allow: ['leisure'], reason: 'play' });
  const quiet = applyQuietWindows(planned, windows);
  planned.length = 0;
  planned.push(...quiet);
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const sent = await notificationRepository.between(dayStart, dayStart + 86400000);
  return governReminders(planned, sent, settings.notifications);
}

async function fire(r: PlannedReminder) {
  const channel = await notificationService.notify({ type: r.type, title: r.title, body: r.body, tag: r.tag });
  await notificationRepository.add({
    id: uid('n_'),
    type: r.type,
    title: r.title,
    body: r.body,
    tag: r.tag,
    scheduledAt: r.at,
    sentAt: clock.now(),
    status: channel === 'none' ? 'failed' : 'sent',
    channel,
  });
}

/**
 * Local scheduler: timers only run while the app is open (PWA limitation on iOS).
 * With a push backend configured, the same plan is synced for background delivery.
 */
export async function rescheduleReminders(): Promise<PlannedReminder[]> {
  planning ??= planToday().finally(() => {
    planning = null;
  });
  const plan = await planning;
  clearTimers();
  const now = clock.now();
  for (const r of plan) {
    const delay = r.at - now;
    if (delay > 0 && delay < 12 * 3600000) timers.push(setTimeout(() => void fire(r), delay));
  }
  if (notificationService.push.isSupported()) {
    void notificationService.push.sync(plan.map((r) => ({ at: r.at, title: r.title, body: r.body, tag: r.tag })));
  }
  void notificationRepository.pruneBefore(now - 14 * 86400000);
  return plan;
}

export function stopReminders() {
  clearTimers();
}
