import type { NotificationRecord, NotificationSettings, NotificationType, Quest, TimeHM } from '@/types';
import { dateTimeToTs, gameMinutes, hmToMinutes, minuteOfDay, minutesToHm } from '@/utils/date';

export interface PlannedReminder {
  type: NotificationType;
  at: number;
  title: string;
  body: string;
  tag: string;
  priority: number;
}

export interface ReminderInput {
  date: string;
  now: number;
  dayStartHour: number;
  settings: NotificationSettings;
  wake: TimeHM;
  sleep: TimeHM;
  quests: Quest[];
  /** activityId → learned reminder minute of day */
  learnedMinute: Record<string, number>;
  water: { current: number; target: number };
  streakAtRisk: boolean;
  streak: number;
}

const PRIORITY: Record<NotificationType, number> = {
  workout: 90,
  streak: 85,
  snooze: 80,
  quest: 70,
  challenge: 50,
  hydration: 40,
  recap: 60,
  achievement: 30,
  levelUp: 30,
};

/** Build today's candidate reminders. The governor decides which actually fire. */
export function planReminders(input: ReminderInput): PlannedReminder[] {
  const { settings, date } = input;
  const out: PlannedReminder[] = [];
  const at = (hm: TimeHM) => dateTimeToTs(date, hm, input.dayStartHour);
  const push = (type: NotificationType, when: number, title: string, body: string, tag: string) => {
    if (!settings.types[type] || when <= input.now) return;
    out.push({ type, at: when, title, body, tag: `${tag}:${date}`, priority: PRIORITY[type] });
  };

  for (const q of input.quests) {
    if (q.status !== 'pending' || q.hidden) continue;
    if (q.snoozedUntil && q.snoozedUntil > input.now) {
      push('snooze', q.snoozedUntil, q.private ? '⏰ Snoozed quest' : `⏰ ${q.title}`, 'Snooze is over. Ready when you are.', `snooze:${q.id}:${q.snoozedUntil}`);
      continue;
    }
    const learned = settings.learnTimes && q.activityId ? input.learnedMinute[q.activityId] : undefined;
    if (q.kind === 'workout') {
      const base = learned ?? (q.scheduledTime ? hmToMinutes(q.scheduledTime) - 30 : undefined);
      if (base !== undefined) push('workout', at(minutesToHm(base)), `🏋️ ${q.title}`, 'Workout in 30 minutes. Shoes on.', `workout:${q.id}`);
    } else if (q.tier !== 'optional' && (q.scheduledTime || learned !== undefined)) {
      const minute = learned ?? hmToMinutes(q.scheduledTime!);
      const title = q.private ? '🛡️ Daily check-in' : `${q.icon} ${q.title}`;
      push('quest', at(minutesToHm(minute)), title, `+${q.xp} XP waiting.`, `quest:${q.id}`);
    }
    if (q.kind === 'challenge') push('challenge', at('12:30'), `⚡ Daily challenge`, q.title, `challenge:${q.id}`);
  }

  if (input.water.target > 0 && input.water.current < input.water.target) {
    const wake = gameMinutes(input.wake, input.dayStartHour);
    const sleep = gameMinutes(input.sleep, input.dayStartHour);
    const nowMin = minuteOfDay(input.now);
    const nowGame = nowMin < input.dayStartHour * 60 ? nowMin + 1440 : nowMin;
    const interval = Math.max(60, settings.hydrationIntervalMin);
    let n = 0;
    for (let m = wake + 120; m < sleep - 90 && n < 3; m += interval) {
      if (m <= nowGame) continue;
      const expected = ((m - wake) / Math.max(1, sleep - wake)) * input.water.target;
      if (input.water.current < expected * 0.8) {
        push('hydration', at(minutesToHm(m)), '💧 Hydration check', 'A glass now keeps the quest on track.', `hydration:${m}`);
        n++;
      }
    }
  }

  if (input.streakAtRisk && input.streak > 0) {
    push('streak', at('21:00'), `🔥 ${input.streak}-day streak at risk`, 'Finish your core quests to keep it alive.', 'streak');
  }
  push('recap', at(settings.recapTime), '📜 Daily recap', 'See how today went and what tomorrow brings.', 'recap');
  return out.sort((a, b) => a.at - b.at);
}

function inQuietHours(ts: number, quietStart: TimeHM, quietEnd: TimeHM): boolean {
  const m = minuteOfDay(ts);
  const s = hmToMinutes(quietStart);
  const e = hmToMinutes(quietEnd);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/**
 * Frequency governor: quiet hours, per-day cap, minimum gap and dedupe.
 * Higher-priority reminders win conflicts.
 */
export function governReminders(
  planned: PlannedReminder[],
  sentToday: Pick<NotificationRecord, 'tag' | 'sentAt' | 'status'>[],
  settings: NotificationSettings,
): PlannedReminder[] {
  const sent = sentToday.filter((n) => n.status === 'sent');
  const sentTags = new Set(sent.map((n) => n.tag));
  const budget = Math.max(0, settings.maxPerDay - sent.length);
  const gap = settings.minGapMin * 60000;
  const candidates = planned
    .filter((p) => !sentTags.has(p.tag))
    .filter((p) => p.type === 'recap' || !inQuietHours(p.at, settings.quietStart, settings.quietEnd))
    .sort((a, b) => b.priority - a.priority || a.at - b.at);
  const accepted: PlannedReminder[] = [];
  const taken = sent.map((n) => n.sentAt ?? 0);
  for (const c of candidates) {
    if (accepted.length >= budget) break;
    if (taken.some((t) => Math.abs(t - c.at) < gap)) continue;
    accepted.push(c);
    taken.push(c.at);
  }
  return accepted.sort((a, b) => a.at - b.at);
}
