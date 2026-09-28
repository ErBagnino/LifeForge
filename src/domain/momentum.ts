/**
 * Momentum: quests finished close together form a combo. It is a feel-good signal only —
 * it never removes anything, never costs XP and simply fades when you take a break.
 */

export const COMBO_GAP_MIN = 45;

export interface Momentum {
  /** Current combo (≥ 2 means "on a roll"); 0 once the window since the last completion has passed. */
  combo: number;
  /** Best combo reached today. */
  best: number;
  /** Minutes left before the current combo fades (0 when there is none). */
  minutesLeft: number;
  /** Completions today. */
  done: number;
}

export function computeMomentum(completedAt: number[], now: number, gapMin = COMBO_GAP_MIN): Momentum {
  const ts = completedAt.filter((t) => Number.isFinite(t) && t <= now).sort((a, b) => a - b);
  const gap = gapMin * 60_000;
  let run = 0;
  let best = 0;
  let prev = -Infinity;
  for (const t of ts) {
    run = t - prev <= gap ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const alive = ts.length > 0 && now - prev <= gap;
  const combo = alive ? run : 0;
  return { combo, best, minutesLeft: alive ? Math.max(0, Math.ceil((prev + gap - now) / 60_000)) : 0, done: ts.length };
}

export function momentumLabel(m: Momentum): string | undefined {
  if (m.combo >= 5) return `Unstoppable ×${m.combo}`;
  if (m.combo >= 3) return `On fire ×${m.combo}`;
  if (m.combo === 2) return 'Combo ×2';
  return undefined;
}
