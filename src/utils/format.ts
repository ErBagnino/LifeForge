const intFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

export function formatCompact(n: number): string {
  return Math.abs(n) < 10000 ? formatInt(n) : compactFmt.format(n);
}

export function formatSigned(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${formatInt(r)}` : formatInt(r);
}

export function formatKg(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
}

export function formatMl(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L` : `${Math.round(ml)} ml`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function labelize(key: string): string {
  return capitalize(key.replace(/_/g, ' '));
}
