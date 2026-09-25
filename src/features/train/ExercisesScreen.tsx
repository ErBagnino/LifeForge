import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ExerciseIllustration } from '@/components/illustration/ExerciseIllustration';
import { muscleLabel } from '@/components/illustration/MuscleMap';
import { Screen } from '@/components/layout/Screen';
import { TextInput } from '@/components/ui/forms';
import { cx } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { workoutRepository } from '@/repositories';
import type { ExerciseCategory } from '@/types';

const CATS: (ExerciseCategory | 'all')[] = ['all', 'strength', 'core', 'cardio', 'mobility'];

export default function ExercisesScreen() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ExerciseCategory | 'all'>('all');
  const { data } = useAsync(() => workoutRepository.exercises.all(), []);
  const list = useMemo(
    () =>
      (data ?? []).filter(
        (e) =>
          (cat === 'all' || e.category === cat) &&
          (e.name.toLowerCase().includes(q.toLowerCase()) || e.muscles.some((m) => muscleLabel(m.muscle).toLowerCase().includes(q.toLowerCase()))),
      ),
    [data, q, cat],
  );
  return (
    <Screen back title="Exercise library" subtitle={`${data?.length ?? 0} exercises with illustrations and muscle maps`}>
      <TextInput value={q} onChange={setQ} placeholder="Search by name or muscle…" type="search" aria-label="Search exercises" className="mt-3" />
      <div className="mt-2 flex gap-1.5">
        {CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={cx('h-11 rounded-full px-3.5 text-[13px] font-semibold capitalize', cat === c ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
            {c}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {list.map((e) => (
          <button key={e.id} type="button" onClick={() => navigate(`/train/exercise/${e.id}`)} className="overflow-hidden rounded-3xl bg-surface p-2 text-left shadow-card">
            <ExerciseIllustration illustration={e.illustration} muscles={e.muscles} size={160} mode="end" className="flex justify-center" />
            <div className="px-1 pt-2 pb-1">
              <div className="truncate text-[14px] font-bold">{e.name}</div>
              <div className="truncate text-[11px] text-muted">{e.muscles.filter((m) => m.level === 'high').map((m) => muscleLabel(m.muscle)).join(' · ')}</div>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}
