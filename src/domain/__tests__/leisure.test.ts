import { describe, expect, it } from 'vitest';
import { elapsedMinutes, leisureStatus, MAX_SESSION_MIN, remainingMinutes, splitSession } from '../leisure';
import { createDefaultSettings } from '@/data/defaultSettings';

const MIN = 60000;

describe('play-time budget', () => {
  it('defaults to 90 minutes a day with a warning at 80%', () => {
    const s = createDefaultSettings();
    expect(s.leisure.enabled).toBe(true);
    expect(s.leisure.dailyLimitMin).toBe(90);
    expect(s.leisure.warnAtPct).toBe(80);
  });

  it('measures a running timer in minutes and never goes negative', () => {
    const start = 1_000_000;
    expect(elapsedMinutes({ startedAt: start, kind: 'games' }, start + 25 * MIN)).toBe(25);
    expect(elapsedMinutes({ startedAt: start, kind: 'games' }, start - MIN)).toBe(0);
  });

  it('reports ok → warn → over against the daily limit', () => {
    expect(leisureStatus(30, 90, 80)).toBe('ok');
    expect(leisureStatus(72, 90, 80)).toBe('warn');
    expect(leisureStatus(90, 90, 80)).toBe('warn');
    expect(leisureStatus(91, 90, 80)).toBe('over');
    expect(remainingMinutes(60, 90)).toBe(30);
    expect(remainingMinutes(120, 90)).toBe(0);
  });

  it('splits a session across the game-day boundary', () => {
    const boundary = 10_000 * MIN;
    expect(splitSession(boundary - 30 * MIN, boundary + 15 * MIN, boundary)).toEqual({ first: 30, second: 15 });
    expect(splitSession(boundary - 40 * MIN, boundary - 10 * MIN, boundary)).toEqual({ first: 30, second: 0 });
    expect(splitSession(boundary + MIN, boundary + 11 * MIN, boundary)).toEqual({ first: 10, second: 0 });
  });

  it('treats absurdly long sessions as forgotten timers', () => {
    expect(MAX_SESSION_MIN).toBe(360);
  });
});
