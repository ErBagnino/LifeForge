/**
 * Timestamp of the next midnight in Pacific Time, when Google resets daily (RPD)
 * quotas. Shared by the server router and the app's usage estimate.
 */
export function nextPacificMidnight(now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const elapsed = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
    return now + (86_400_000 - elapsed);
  } catch {
    return now + 24 * 3_600_000;
  }
}
