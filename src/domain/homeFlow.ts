import type { Achievement, Activity, Building, Quest } from '@/types';
import { conditionProgress, type Counters } from './achievements';
import type { ContextState } from './dailyContext';
import { buildBlockers, buildingCost } from './tycoon';

/**
 * Home flow: the pieces that make the Home read as one path through the day —
 * the day journey, the next unlocks and the single "one more thing" suggestion.
 * Pure functions; everything is derived from real state.
 */

export type StageId = 'wake' | 'morning' | 'work' | 'afternoon' | 'train' | 'evening' | 'rest';

export interface DayStage {
  id: StageId;
  label: string;
  icon: string;
  status: 'done' | 'now' | 'next';
}

const STAGE_INFO: Record<StageId, { label: string; icon: string }> = {
  wake: { label: 'Wake', icon: '🌅' },
  morning: { label: 'Morning', icon: '☀️' },
  work: { label: 'Work', icon: '💼' },
  afternoon: { label: 'Afternoon', icon: '🌤️' },
  train: { label: 'Train', icon: '🏋️' },
  evening: { label: 'Evening', icon: '🌆' },
  rest: { label: 'Rest', icon: '🌙' },
};

export interface StageInput {
  state?: ContextState;
  /** Local hour 0–23. */
  hour: number;
  dayStartHour: number;
  workPlanned: boolean;
  workDone: boolean;
  workoutToday: boolean;
  workoutDone: boolean;
}

/** The day as a short path: Wake → Morning → (Work) → (Train) → Evening → Rest, with the current stage marked. */
export function dayStages(i: StageInput): DayStage[] {
  const ids: StageId[] = ['wake', 'morning'];
  ids.push(i.workPlanned || i.state === 'WORK' || i.workDone ? 'work' : 'afternoon');
  if (i.workoutToday) ids.push('train');
  ids.push('evening', 'rest');
  const current = currentStage(i, ids);
  const at = ids.indexOf(current);
  return ids.map((id, k) => ({ id, ...STAGE_INFO[id], status: k < at ? 'done' : k === at ? 'now' : 'next' }));
}

function currentStage(i: StageInput, ids: StageId[]): StageId {
  const has = (s: StageId) => ids.includes(s);
  switch (i.state) {
    case 'SLEEP':
    case 'WIND_DOWN':
      return 'rest';
    case 'WAKE_UP':
      return 'wake';
    case 'WORK':
      return 'work';
    case 'TRAINING':
      return has('train') ? 'train' : 'evening';
    case 'EVENING':
      return 'evening';
    case 'POST_WORK':
      return has('train') && !i.workoutDone ? 'train' : 'evening';
    default:
      break;
  }
  // Morning / afternoon / weekend: follow the clock (game-day hours, so 01:00 is "late").
  const h = i.hour < i.dayStartHour ? i.hour + 24 : i.hour;
  if (h >= 22) return 'rest';
  if (h >= 19) return 'evening';
  if (h >= 12) {
    if (has('work') && !i.workDone && i.workPlanned) return 'work';
    if (has('train') && !i.workoutDone && h >= 16) return 'train';
    return has('afternoon') ? 'afternoon' : has('train') && !i.workoutDone ? 'train' : 'evening';
  }
  return h < 7 ? 'wake' : 'morning';
}

export interface Unlock {
  kind: 'level' | 'building' | 'achievement';
  icon: string;
  title: string;
  /** What is still missing, e.g. "730 🪙" or "120 XP". */
  remaining: string;
  progress: number;
  /** Route to open. */
  to: string;
}

export interface UnlockInput {
  level: number;
  xpInto: number;
  xpNeeded: number;
  maxLevel: number;
  coins: number;
  buildings: Building[];
  achievements: Achievement[];
  counters: Counters;
  text?: (s: string) => string;
}

/** The closest next level, room and achievement — always real numbers. */
export function nextUnlocks(i: UnlockInput): Unlock[] {
  const out: Unlock[] = [];
  const text = i.text ?? ((s: string) => s);
  if (i.level < i.maxLevel) out.push({ kind: 'level', icon: '⭐', title: `Reach level ${i.level + 1}`, remaining: `${Math.max(0, Math.round(i.xpNeeded - i.xpInto)).toLocaleString('en-US')} XP`, progress: i.xpNeeded > 0 ? i.xpInto / i.xpNeeded : 1, to: '/profile' });
  const candidates = i.buildings
    // Same rules as building: player level for that level and prerequisite rooms (coins aside).
    .filter((b) => buildBlockers(b, i.level, Number.POSITIVE_INFINITY, i.buildings).length === 0)
    .map((b) => ({ b, cost: buildingCost(b, b.level + 1) }))
    .sort((a, c) => a.cost - c.cost);
  const room = candidates[0];
  if (room) out.push({ kind: 'building', icon: room.b.icon, title: `${room.b.name} Lv.${room.b.level + 1}`, remaining: room.cost > i.coins ? `${(room.cost - i.coins).toLocaleString('en-US')} 🪙` : 'ready to build', progress: Math.min(1, i.coins / Math.max(1, room.cost)), to: `/world?room=${room.b.id}` });
  const ach = i.achievements
    .filter((a) => !a.unlockedAt && !a.hidden)
    .map((a) => ({ a, p: conditionProgress(a.condition, i.counters) }))
    .filter((x) => x.p.ratio < 1 && x.p.ratio > 0)
    .sort((x, y) => y.p.ratio - x.p.ratio)[0];
  if (ach) out.push({ kind: 'achievement', icon: ach.a.icon, title: `Badge: ${text(ach.a.name)}`, remaining: `${Math.floor(ach.p.current).toLocaleString('en-US')}/${ach.p.target.toLocaleString('en-US')}`, progress: ach.p.ratio, to: '/achievements' });
  return out;
}

export type OneMore = { kind: 'quest'; quest: Quest } | { kind: 'activity'; activity: Activity };

export interface OneMoreInput {
  quests: Quest[];
  activities: Activity[];
  energy: number;
  now: number;
  /** Minutes realistically free now (undefined = unknown). */
  freeMinutes?: number;
  /** Seed so the suggestion is stable for the day. */
  seed: string;
}

/**
 * "One more thing?": after the core is done, one small optional thing — never a list.
 * Prefers a pending optional quest; otherwise a 5–15 minute activity not done today.
 */
export function oneMoreThing(i: OneMoreInput): OneMore | undefined {
  const cap = Math.min(i.freeMinutes ?? 30, i.energy < 30 ? 10 : 30);
  if (cap < 5) return undefined;
  const pending = i.quests
    .filter((q) => q.status === 'pending' && !q.hidden && !q.private && !q.goal && !q.metric && q.tier === 'optional' && q.durationMin <= cap && (!q.snoozedUntil || q.snoozedUntil <= i.now))
    .sort((a, b) => a.durationMin - b.durationMin || b.xp - a.xp);
  if (pending[0]) return { kind: 'quest', quest: pending[0] };
  const today = new Set(i.quests.map((q) => q.activityId).filter(Boolean));
  const micro = i.activities.filter((a) => a.active && !a.metric && !a.tags?.includes('private') && a.durationMin >= 5 && a.durationMin <= Math.min(15, cap) && !today.has(a.id));
  if (!micro.length) return undefined;
  const k = [...i.seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % micro.length;
  return { kind: 'activity', activity: micro.sort((a, b) => a.id.localeCompare(b.id))[k] };
}
