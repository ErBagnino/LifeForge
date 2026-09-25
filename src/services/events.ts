import type { LevelPerk } from '@/domain/level';
import type { Multiplier } from '@/domain/rewards';
import type { Achievement, PersonalRecord, QuestKind, Rarity, StatMap } from '@/types';

/** Feedback produced by services and consumed by the FX layer (toasts, overlays, haptics). */
export type GameEvent =
  | {
      type: 'questComplete';
      questId: string;
      title: string;
      icon: string;
      kind: QuestKind;
      rarity: Rarity;
      xp: number;
      coins: number;
      stats: StatMap;
      hp: number;
      energy: number;
      multipliers: Multiplier[];
    }
  | { type: 'levelUp'; level: number; perks: LevelPerk[] }
  | { type: 'achievement'; achievement: Achievement }
  | { type: 'routine'; name: string; icon: string; xp: number; coins: number }
  | { type: 'record'; record: PersonalRecord }
  | { type: 'coach'; text: string; icon: string }
  | { type: 'streak'; value: number; kind: 'extended' | 'frozen' | 'broken' | 'revived'; milestone?: number }
  | { type: 'building'; buildingId: string; name: string; icon: string; level: number }
  | { type: 'purchase'; name: string; icon: string }
  | { type: 'feature'; label: string }
  | { type: 'toast'; text: string; icon?: string; tone?: 'info' | 'success' | 'warn' }
  | { type: 'dayClosed'; date: string; score: number; success: boolean };

export interface ServiceResult {
  events: GameEvent[];
}
