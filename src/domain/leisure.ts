import type { LeisureKind } from '@/types';

export interface LeisureTimer {
  startedAt: number;
  kind: LeisureKind;
}

export const LEISURE_KINDS: Record<LeisureKind, { label: string; short: string; icon: string }> = {
  games: { label: 'Games', short: 'Games', icon: '🎮' },
  short_video: { label: 'TikTok / Reels / Shorts', short: 'TikTok', icon: '📱' },
  streaming: { label: 'YouTube / streaming', short: 'YouTube', icon: '📺' },
  social: { label: 'Social scrolling', short: 'Social', icon: '🌀' },
  other: { label: 'Other', short: 'Other', icon: '🕹️' },
};

/** Sessions longer than this are almost certainly a forgotten timer. */
export const MAX_SESSION_MIN = 6 * 60;

export function elapsedMinutes(timer: LeisureTimer, now: number): number {
  return Math.max(0, (now - timer.startedAt) / 60000);
}

export type LeisureStatus = 'ok' | 'warn' | 'over';

/** Daily play-time budget status (budget resets every game day). */
export function leisureStatus(usedMin: number, limitMin: number, warnAtPct: number): LeisureStatus {
  if (usedMin > limitMin) return 'over';
  if (usedMin >= (limitMin * warnAtPct) / 100) return 'warn';
  return 'ok';
}

export function remainingMinutes(usedMin: number, limitMin: number): number {
  return Math.max(0, limitMin - usedMin);
}

/**
 * Split a session across the game-day boundary so each day gets its own minutes.
 * `boundaryTs` is the start of the next game day (e.g. 04:00).
 */
export function splitSession(startTs: number, endTs: number, boundaryTs: number): { first: number; second: number } {
  const total = Math.max(0, endTs - startTs) / 60000;
  if (endTs <= boundaryTs || startTs >= boundaryTs) return { first: total, second: 0 };
  return { first: (boundaryTs - startTs) / 60000, second: (endTs - boundaryTs) / 60000 };
}
