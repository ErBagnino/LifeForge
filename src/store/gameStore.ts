import { create } from 'zustand';
import type { LeisureTimer } from '@/domain/leisure';
import {
  playerRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  tycoonRepository,
} from '@/repositories';
import { clock } from '@/services/clock';
import type { GameEvent } from '@/services/events';
import { planFor } from '@/services/game/dayPlan';
import { ensureToday, unlockFeaturesToday } from '@/services/game/dayService';
import { haptics } from '@/services/haptics';
import { getLeisureTimer } from '@/services/metricsService';
import { rescheduleReminders } from '@/services/notifications/reminderScheduler';
import { ensureSeeded } from '@/services/seedService';
import { pendingSuggestions, refreshSuggestions } from '@/services/suggestionService';
import type { Building, DayLog, DayPlan, Player, Quest, Settings, Suggestion } from '@/types';

export interface TodayState {
  date: string;
  quests: Quest[];
  long: Quest[];
  log?: DayLog;
  plan: DayPlan;
}

export type BootStatus = 'booting' | 'onboarding' | 'ready' | 'error';

interface GameStore {
  status: BootStatus;
  error?: string;
  player?: Player;
  settings?: Settings;
  buildings: Building[];
  today?: TodayState;
  suggestions: Suggestion[];
  leisureTimer?: LeisureTimer;
  /** Bumped after every mutation so history screens can refetch. */
  version: number;
  fx: GameEvent[];
  boot(): Promise<void>;
  refresh(): Promise<void>;
  act<T extends { events: GameEvent[]; features?: string[] }>(p: Promise<T>): Promise<T>;
  pushFx(...events: GameEvent[]): void;
  shiftFx(): void;
  setStatus(status: BootStatus): void;
}

let reminderTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReminders() {
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => void rescheduleReminders().catch(() => undefined), 1500);
}

function feedback(events: GameEvent[]) {
  if (events.some((e) => e.type === 'levelUp')) haptics.levelUp();
  else if (events.some((e) => e.type === 'achievement')) haptics.achievement();
  else if (events.some((e) => e.type === 'questComplete' || e.type === 'building' || e.type === 'purchase')) haptics.success();
  else if (events.some((e) => e.type === 'toast' && e.tone === 'warn')) haptics.warning();
}

export const useGame = create<GameStore>((set, get) => ({
  status: 'booting',
  buildings: [],
  suggestions: [],
  version: 0,
  fx: [],

  setStatus: (status) => set({ status }),

  async boot() {
    try {
      await ensureSeeded();
      const settings = await settingsRepository.get();
      if (!settings) throw new Error('Settings missing after seeding');
      clock.setOffset(settings.clockOffsetMs ?? 0);
      clock.setDayStartHour(settings.dayStartHour);
      haptics.setEnabled(settings.haptics);
      if (!settings.onboarded) {
        set({ status: 'onboarding', settings });
        return;
      }
      const r = await ensureToday();
      await get().refresh();
      set({ status: 'ready' });
      if (r.events.length) get().pushFx(...r.events);
      void refreshSuggestions()
        .then(pendingSuggestions)
        .then((suggestions) => set({ suggestions }))
        .catch(() => undefined);
      scheduleReminders();
    } catch (e) {
      console.error(e);
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  async refresh() {
    const date = clock.today();
    const [player, settings, buildings, day, long, log, suggestions, leisureTimer] = await Promise.all([
      playerRepository.get(),
      settingsRepository.get(),
      tycoonRepository.buildings.all(),
      questRepository.byDate(date),
      questRepository.longActive(date),
      statsRepository.getLog(date),
      pendingSuggestions(),
      getLeisureTimer(),
    ]);
    const plan = settings ? await planFor(date, settings) : undefined;
    set((s) => ({
      player,
      settings,
      buildings,
      suggestions,
      leisureTimer,
      today: plan ? { date, quests: day.filter((q) => q.kind !== 'weekly' && q.kind !== 'boss'), long, log, plan } : s.today,
      version: s.version + 1,
    }));
  },

  async act(p) {
    const result = await p;
    let events = result.events;
    if (result.features?.length) {
      events = [...events, ...result.features.map((label) => ({ type: 'feature' as const, label }))];
      const unlocked = await unlockFeaturesToday();
      events.push(...unlocked.events);
    }
    await get().refresh();
    if (events.length) {
      feedback(events);
      get().pushFx(...events);
    }
    scheduleReminders();
    return result;
  },

  pushFx: (...events) => set((s) => ({ fx: [...s.fx, ...events] })),
  shiftFx: () => set((s) => ({ fx: s.fx.slice(1) })),
}));

/** Re-check the day boundary when the app comes back to the foreground. */
export async function onResume(): Promise<void> {
  const { status, act } = useGame.getState();
  if (status !== 'ready') return;
  await act(ensureToday());
}
