import type { DayPlan, Quest, Recurrence } from '@/types';
import { dateTimeToTs, gameMinutes, minutesToHm, tsToHm } from '@/utils/date';
import { activeBlock } from './workload';

export type SnoozeKind = '30m' | '1h' | 'after_work' | 'tonight' | 'before_bed' | 'tomorrow';

export interface SnoozeOption {
  kind: SnoozeKind;
  label: string;
  detail: string;
  /** Timestamp for same-day snoozes; undefined for "tomorrow" (a move). */
  until?: number;
}

/** Smart snooze suggestions based on time, the work schedule and bedtime. */
export function snoozeOptions(
  now: number,
  nowMin: number,
  date: string,
  plan: Pick<DayPlan, 'work' | 'busy' | 'sleep'>,
  recurrence: Recurrence | undefined,
  dayStartHour: number,
): SnoozeOption[] {
  const options: SnoozeOption[] = [];
  const bedtime = gameMinutes(plan.sleep, dayStartHour);
  const nowGame = nowMin < dayStartHour * 60 ? nowMin + 1440 : nowMin;
  const add = (kind: SnoozeKind, label: string, atGameMin: number) => {
    if (atGameMin >= bedtime - 10 || atGameMin <= nowGame) return;
    const hm = minutesToHm(atGameMin);
    const until = dateTimeToTs(date, hm, dayStartHour);
    options.push({ kind, label, detail: hm, until });
  };

  options.push({ kind: '30m', label: '30 min', detail: tsToHm(now + 30 * 60000), until: now + 30 * 60000 });
  options.push({ kind: '1h', label: '1 hour', detail: tsToHm(now + 60 * 60000), until: now + 60 * 60000 });

  const block = activeBlock(plan, nowMin);
  if (block && plan.work && block === plan.work) {
    add('after_work', 'After work', gameMinutes(plan.work.end, dayStartHour) + 15);
  }
  if (nowGame < 20 * 60) add('tonight', 'Tonight', 20 * 60 + 30);
  else add('before_bed', 'Before bed', bedtime - 45);

  if (!recurrence || recurrence.type !== 'daily') {
    options.push({ kind: 'tomorrow', label: 'Tomorrow', detail: 'Move to tomorrow' });
  }
  const valid = options.filter((o) => !o.until || gameMinutes(tsToHm(o.until), dayStartHour) < bedtime);
  return valid.slice(0, 4);
}

export interface PostponeWarning {
  level: 'info' | 'warn' | 'alert';
  text: string;
}

/** Flag important quests that keep getting pushed around. */
export function postponeWarning(quest: Quest, movedLast7d: number, warnAt: number): PostponeWarning | undefined {
  const total = quest.snoozeCount + movedLast7d;
  if (quest.tier === 'optional' || total < warnAt - 1) return undefined;
  if (total >= warnAt + 2) {
    return { level: 'alert', text: `Postponed ${total} times. This one is dodging you — or you're dodging it.` };
  }
  if (total >= warnAt) {
    return { level: 'warn', text: `Snoozed ${total} times. Maybe make it smaller instead of later?` };
  }
  return { level: 'info', text: 'Heads up: this keeps sliding.' };
}
