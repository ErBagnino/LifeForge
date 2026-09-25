let counter = 0;

/** Short, sortable, collision-resistant id (no dependency on crypto availability). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${time}${counter.toString(36).padStart(4, '0')}${rand}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}
