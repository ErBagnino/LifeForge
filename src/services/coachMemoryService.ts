import { metaRepository } from '@/repositories';
import { uid } from '@/utils/id';
import { clock } from './clock';

/**
 * Coach memory: short notes the player asked the Coach to keep ("I hate running",
 * "Tuesdays I play football"). Stored only on this device, fully visible and editable in
 * Settings → Coach memory, included in backups, and sent to Gemini only as part of a chat
 * turn the player starts. Never written without the player asking.
 */

export interface MemoryNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export const MEMORY_MAX_NOTES = 30;
export const MEMORY_MAX_CHARS = 200;
const KEY = 'coachMemory';

export async function listMemory(): Promise<MemoryNote[]> {
  return (await metaRepository.get<MemoryNote[]>(KEY)) ?? [];
}

async function write(notes: MemoryNote[]) {
  await metaRepository.set(KEY, notes);
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MEMORY_MAX_CHARS);
}

export async function addMemory(text: string): Promise<{ ok: boolean; note?: MemoryNote; message: string }> {
  const value = clean(text);
  if (value.length < 2) return { ok: false, message: 'That note is empty.' };
  const notes = await listMemory();
  const dup = notes.find((n) => n.text.toLowerCase() === value.toLowerCase());
  if (dup) return { ok: true, note: dup, message: 'I already remember that.' };
  if (notes.length >= MEMORY_MAX_NOTES) return { ok: false, message: `Memory is full (${MEMORY_MAX_NOTES} notes). Remove one in Settings → Coach memory.` };
  const now = clock.now();
  const note: MemoryNote = { id: uid('mem_'), text: value, createdAt: now, updatedAt: now };
  await write([...notes, note]);
  return { ok: true, note, message: 'Saved to my memory.' };
}

export async function updateMemory(id: string, text: string): Promise<boolean> {
  const value = clean(text);
  const notes = await listMemory();
  if (!value || !notes.some((n) => n.id === id)) return false;
  await write(notes.map((n) => (n.id === id ? { ...n, text: value, updatedAt: clock.now() } : n)));
  return true;
}

export async function removeMemory(id: string): Promise<void> {
  await write((await listMemory()).filter((n) => n.id !== id));
}

/** Remove notes matching a phrase ("forget the running note"). Returns what was removed. */
export async function forgetMatching(query: string): Promise<MemoryNote[]> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !['the', 'note', 'about', 'that', 'nota', 'che', 'della', 'sulla'].includes(w));
  if (!words.length) return [];
  const notes = await listMemory();
  const hit = notes.filter((n) => words.every((w) => n.text.toLowerCase().includes(w)));
  if (hit.length) await write(notes.filter((n) => !hit.includes(n)));
  return hit;
}

export async function clearMemory(): Promise<void> {
  await metaRepository.remove(KEY);
}
