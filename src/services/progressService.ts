import { buildJourney, chapterSummaries, type ChapterSummary, type Milestone } from '@/domain/journey';
import { computeMastery, perkById, type Perk, type TrackMastery } from '@/domain/mastery';
import { computeMomentum, type Momentum } from '@/domain/momentum';
import { worldCollections, worldEvents, type Collection, type WorldEvent } from '@/domain/world';
import { achievementRepository, metaRepository, playerRepository, questRepository, settingsRepository, statsRepository, tycoonRepository } from '@/repositories';
import type { ActivityCategory, ISODate } from '@/types';
import { daysBetween, shiftDate, toISODate, weekday } from '@/utils/date';
import { clock } from './clock';
import { resolveText } from './game/questFactory';

/**
 * Long-term progression views (mastery, perks, momentum, chapters, journey, showcase).
 * All read-only derivations of stored history, plus two small player choices kept in meta:
 * the equipped perk title and the achievement showcase.
 */

const FAR_PAST = '2000-01-01';

async function progressStart(): Promise<ISODate> {
  return (await metaRepository.get<ISODate>('progressSince')) ?? (await metaRepository.get<ISODate>('adventureStart')) ?? FAR_PAST;
}

export async function loadMastery(): Promise<TrackMastery[]> {
  const today = clock.today();
  const quests = await questRepository.byRange(await progressStart(), today);
  return computeMastery(quests, today);
}

export async function loadMomentum(): Promise<Momentum> {
  const quests = await questRepository.byDate(clock.today());
  return computeMomentum(
    quests.filter((q) => q.status === 'completed' && q.completedAt).map((q) => q.completedAt!),
    clock.now(),
  );
}

export async function getEquippedTitle(): Promise<Perk | undefined> {
  const id = await metaRepository.get<string>('equippedTitle');
  return id ? perkById(id) : undefined;
}

/** Equip an unlocked perk title (or `null` to show none). Refuses titles not yet earned. */
export async function equipTitle(id: string | null): Promise<{ ok: boolean; message: string }> {
  if (id === null) {
    await metaRepository.remove('equippedTitle');
    return { ok: true, message: 'Title removed' };
  }
  const perk = perkById(id);
  if (!perk) return { ok: false, message: 'Unknown title' };
  const track = (await loadMastery()).find((t) => t.id === perk.track);
  if (!track || track.level < perk.level) return { ok: false, message: `Reach ${track?.label ?? ''} mastery ${perk.level} first` };
  await metaRepository.set('equippedTitle', id);
  return { ok: true, message: `Title equipped: ${perk.title}` };
}

export const SHOWCASE_MAX = 3;

export async function getShowcase(): Promise<string[]> {
  return (await metaRepository.get<string[]>('achievementShowcase')) ?? [];
}

/** Pin/unpin an unlocked achievement (max three, newest pin wins the last slot). */
export async function toggleShowcase(id: string): Promise<string[]> {
  const list = await getShowcase();
  if (list.includes(id)) {
    const next = list.filter((x) => x !== id);
    await metaRepository.set('achievementShowcase', next);
    return next;
  }
  const a = await achievementRepository.get(id);
  if (!a?.unlockedAt) return list;
  const next = [...list, id].slice(-SHOWCASE_MAX);
  await metaRepository.set('achievementShowcase', next);
  return next;
}

export interface JourneyData {
  start: ISODate;
  today: ISODate;
  adventureDay: number;
  chapters: ChapterSummary[];
  milestones: Milestone[];
}

export async function loadJourney(): Promise<JourneyData | undefined> {
  const start = await metaRepository.get<ISODate>('adventureStart');
  if (!start) return undefined;
  const today = clock.today();
  const [logs, achievements, ledger, records, settings, since] = await Promise.all([
    statsRepository.logs(start, today),
    achievementRepository.all(),
    statsRepository.ledger(start, today),
    statsRepository.records(),
    settingsRepository.get(),
    metaRepository.get<ISODate>('progressSince'),
  ]);
  const pet = settings?.profile.petName ?? 'Sky';
  const milestones = buildJourney({ start, today, logs, achievements, ledger, records, text: (s) => resolveText(s, pet), toDate: (ts) => toISODate(new Date(ts - (settings?.dayStartHour ?? 4) * 3600_000)) });
  if (since && since > start) milestones.push({ id: 'progress-reset', date: since, kind: 'chapter', icon: '🔄', title: 'New run started', detail: 'Game progress reset — history kept' });
  milestones.sort((a, b) => b.date.localeCompare(a.date));
  const adventureDay = Math.max(1, daysBetween(start, today) + 1);
  return { start, today, adventureDay, chapters: chapterSummaries(start, today, logs), milestones };
}


export async function loadWorldExtras(): Promise<{ events: WorldEvent[]; collections: Collection[] }> {
  const today = clock.today();
  const from = shiftDate(today, -6);
  const [player, settings, logs, quests, buildings, cosmetics, mastery] = await Promise.all([
    playerRepository.get(),
    settingsRepository.get(),
    statsRepository.logs(from, today),
    questRepository.byRange(from, today),
    tycoonRepository.buildings.all(),
    tycoonRepository.cosmetics.all(),
    loadMastery(),
  ]);
  const categories: Partial<Record<ActivityCategory, number>> = {};
  for (const q of quests) if (q.status === 'completed') categories[q.category] = (categories[q.category] ?? 0) + 1;
  const target = settings?.hydration.targetMl ?? 0;
  const events = worldEvents({
    date: today,
    weekday: weekday(today),
    streak: player?.streak.current ?? 0,
    week: {
      workouts: logs.reduce((s, l) => s + l.workouts, 0),
      waterDays: target > 0 ? logs.filter((l) => (l.metrics.water ?? 0) >= target).length : 0,
      activeDays: logs.filter((l) => l.core.done + l.important.done + l.optional.done > 0 || l.workouts > 0).length,
      successDays: logs.filter((l) => l.closed && l.success).length,
      days: logs.length,
    },
    categories,
    buildings,
  });
  return { events, collections: worldCollections({ buildings, cosmetics, mastery }) };
}
