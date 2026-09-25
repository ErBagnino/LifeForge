import { CATEGORY_INFO, STAT_INFO } from '@/data/categories';
import { achievementRepository, activityRepository, settingsRepository, tycoonRepository, workoutRepository } from '@/repositories';
import { resolveText } from './game/questFactory';

export interface SearchResult {
  id: string;
  kind: 'activity' | 'exercise' | 'achievement' | 'building' | 'stat' | 'page';
  title: string;
  subtitle: string;
  icon: string;
  route: string;
}

const PAGES: Omit<SearchResult, 'id' | 'kind'>[] = [
  { title: 'Calendar', subtitle: 'Month / week / day history', icon: '📅', route: '/stats/calendar' },
  { title: 'Advanced stats', subtitle: 'Charts and trends', icon: '📈', route: '/stats/advanced' },
  { title: 'Personal records', subtitle: 'PRs', icon: '🏆', route: '/stats/records' },
  { title: 'Weekly review', subtitle: 'This week as a chapter', icon: '🗓️', route: '/review/week' },
  { title: 'Daily recap', subtitle: 'How today went', icon: '📜', route: '/review/day' },
  { title: 'Achievements', subtitle: 'Unlocked and locked', icon: '🏅', route: '/achievements' },
  { title: 'Character', subtitle: 'Class, stats, avatar', icon: '🧙', route: '/profile' },
  { title: 'Shop', subtitle: 'Items, cosmetics, rewards', icon: '🛍️', route: '/world/shop' },
  { title: 'Settings', subtitle: 'Profile, schedule, targets, data', icon: '⚙️', route: '/settings' },
  { title: 'Schedule', subtitle: 'Work hours and free time', icon: '🕰️', route: '/settings/schedule' },
  { title: 'Targets', subtitle: 'Nutrition, steps, water, play time', icon: '🎯', route: '/settings/targets' },
  { title: 'Notifications', subtitle: 'Reminders and push', icon: '🔔', route: '/settings/notifications' },
  { title: 'Data export / import', subtitle: 'JSON backup', icon: '💾', route: '/settings/data' },
  { title: 'Admin', subtitle: 'Activities, rules, economy', icon: '🛠️', route: '/admin' },
  { title: 'Game rules', subtitle: 'Score, XP, penalties, smart rules', icon: '📐', route: '/admin/rules' },
  { title: 'Create with AI', subtitle: 'Prompt + JSON import', icon: '🤖', route: '/admin/ai' },
  { title: 'Workout plan', subtitle: 'Edit your program', icon: '📋', route: '/train/plan' },
  { title: 'Exercise library', subtitle: 'Illustrations and muscles', icon: '🏋️', route: '/train/exercises' },
  { title: 'Cardio program', subtitle: 'Walk → run progression', icon: '🏃', route: '/train/cardio' },
  { title: 'Play time', subtitle: 'Daily 1h30 budget timer', icon: '🎮', route: '/play' },
  { title: 'Routines', subtitle: 'Morning, night, workout, recovery', icon: '🌅', route: '/quests/routines' },
];

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(` ${q}`)) return 60;
  if (t.includes(q)) return 40;
  return 0;
}

export async function globalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const [activities, exercises, achievements, buildings, settings] = await Promise.all([
    activityRepository.all(),
    workoutRepository.exercises.all(),
    achievementRepository.all(),
    tycoonRepository.buildings.all(),
    settingsRepository.get(),
  ]);
  const pet = settings?.profile.petName ?? 'Sky';
  const scored: (SearchResult & { s: number })[] = [];
  for (const a of activities) {
    const title = resolveText(a.name, pet);
    const s = Math.max(score(title, q), score(CATEGORY_INFO[a.category].label, q) * 0.6, score(a.description ?? '', q) * 0.4);
    if (s) scored.push({ id: a.id, kind: 'activity', title, subtitle: `${CATEGORY_INFO[a.category].label} · ${a.tier}`, icon: a.icon, route: `/admin/activities/${a.id}`, s });
  }
  for (const e of exercises) {
    const s = Math.max(score(e.name, q), score(e.equipment, q) * 0.5, ...e.muscles.map((m) => score(m.muscle.replace('_', ' '), q) * 0.6));
    if (s) scored.push({ id: e.id, kind: 'exercise', title: e.name, subtitle: e.equipment, icon: '🏋️', route: `/train/exercise/${e.id}`, s });
  }
  for (const a of achievements) {
    if (a.hidden && !a.unlockedAt) continue;
    const title = resolveText(a.name, pet);
    const s = Math.max(score(title, q), score(a.description, q) * 0.5);
    if (s) scored.push({ id: a.id, kind: 'achievement', title, subtitle: a.unlockedAt ? 'Unlocked' : a.description, icon: a.icon, route: '/achievements', s });
  }
  for (const b of buildings) {
    const s = Math.max(score(b.name, q), score(b.lifeArea, q) * 0.6);
    if (s) scored.push({ id: b.id, kind: 'building', title: b.name, subtitle: b.level ? `Level ${b.level}` : 'Not built', icon: b.icon, route: `/world?room=${b.id}`, s });
  }
  for (const [key, info] of Object.entries(STAT_INFO)) {
    const s = score(info.label, q);
    if (s) scored.push({ id: key, kind: 'stat', title: info.label, subtitle: 'Character stat', icon: info.icon, route: '/profile', s });
  }
  for (const p of PAGES) {
    const s = Math.max(score(p.title, q), score(p.subtitle, q) * 0.5);
    if (s) scored.push({ ...p, id: p.route, kind: 'page', s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, 40);
}
