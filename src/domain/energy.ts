import type { EnergyRules } from '@/types';
import { clamp } from '@/utils/math';

export interface StartingEnergyInput {
  sleepHours?: number;
  restDay: boolean;
  maxEnergy: number;
  recoveryMode: boolean;
}

/**
 * Energy at the start of a game day. Driven mainly by manually logged sleep.
 * It is a game resource, not a physiological measurement.
 */
export function startingEnergy(input: StartingEnergyInput, rules: EnergyRules): number {
  let energy =
    input.sleepHours === undefined
      ? rules.unknownSleepStart
      : rules.sleepBase + input.sleepHours * rules.sleepPerHour;
  if (input.restDay) energy += rules.restDayBonus;
  if (input.recoveryMode) energy = input.maxEnergy;
  return Math.round(clamp(energy, rules.minStart, input.maxEnergy));
}

/** Apply a cost (positive) or restoration (negative). Energy never blocks real-life actions. */
export function applyEnergyCost(current: number, cost: number, maxEnergy: number): number {
  return Math.round(clamp(current - cost, 0, maxEnergy));
}

/** Re-base energy when sleep is logged after the day already started. */
export function rebaseEnergyForSleep(
  current: number,
  previousStart: number,
  newStart: number,
  maxEnergy: number,
): number {
  return Math.round(clamp(current + (newStart - previousStart), 0, maxEnergy));
}

export type EnergyBand = 'full' | 'good' | 'low' | 'empty';

export function energyBand(energy: number, max: number): EnergyBand {
  const r = energy / Math.max(1, max);
  if (r >= 0.75) return 'full';
  if (r >= 0.4) return 'good';
  if (r > 0.1) return 'low';
  return 'empty';
}
