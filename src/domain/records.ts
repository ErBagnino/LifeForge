import type { PersonalRecord, SessionExercise } from '@/types';

export interface RecordCandidate {
  id: string;
  kind: PersonalRecord['kind'];
  label: string;
  value: number;
  unit: string;
  refId?: string;
}

/** Compare candidates with existing records; return only real improvements. */
export function detectRecords(
  candidates: RecordCandidate[],
  existing: Map<string, PersonalRecord>,
  date: string,
  now: number,
): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  for (const c of candidates) {
    if (c.value <= 0) continue;
    const prev = existing.get(c.id);
    if (prev && prev.value >= c.value) continue;
    out.push({ ...c, previous: prev?.value, date, updatedAt: now });
  }
  return out;
}

export function exerciseRecordCandidates(
  ex: SessionExercise,
  name: string,
  measure: 'reps' | 'time',
  bodyweight: boolean,
): RecordCandidate[] {
  const done = ex.sets.filter((s) => s.completed);
  if (!done.length) return [];
  const out: RecordCandidate[] = [];
  const bestReps = Math.max(...done.map((s) => s.reps));
  if (!bodyweight && measure === 'reps') {
    const maxWeight = Math.max(...done.map((s) => s.weight));
    const volume = done.reduce((s, x) => s + x.weight * x.reps, 0);
    out.push({ id: `ex:${ex.exerciseId}:weight`, kind: 'exercise_weight', label: `${name} · max weight`, value: maxWeight, unit: 'kg', refId: ex.exerciseId });
    out.push({ id: `ex:${ex.exerciseId}:volume`, kind: 'exercise_volume', label: `${name} · session volume`, value: Math.round(volume), unit: 'kg', refId: ex.exerciseId });
  }
  out.push({
    id: `ex:${ex.exerciseId}:reps`,
    kind: 'exercise_reps',
    label: `${name} · ${measure === 'time' ? 'longest set' : 'max reps'}`,
    value: bestReps,
    unit: measure === 'time' ? 's' : 'reps',
    refId: ex.exerciseId,
  });
  return out;
}
