import { useEffect, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Select, TextInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useAsync } from '@/hooks';
import { workoutRepository } from '@/repositories';
import { savePlan } from '@/services/adminService';
import { useGame } from '@/store/gameStore';
import type { TemplateExercise, WorkoutPlan, WorkoutTemplate } from '@/types';
import { uid } from '@/utils/id';

const DAYS = [
  { value: -1, label: 'Unscheduled' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export default function PlanEditor() {
  const refresh = useGame((s) => s.refresh);
  const { data } = useAsync(async () => ({ plan: await workoutRepository.activePlan(), exercises: await workoutRepository.exercises.all() }), [], { live: false });
  const [plan, setPlan] = useState<WorkoutPlan | undefined>();
  const [picker, setPicker] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data?.plan) setPlan(structuredClone(data.plan));
  }, [data?.plan]);
  if (!data || !plan) return null;
  const exName = (id: string) => data.exercises.find((e) => e.id === id)?.name ?? id;

  const setTemplate = (i: number, t: WorkoutTemplate) => {
    setSaved(false);
    setPlan({ ...plan, templates: plan.templates.map((x, j) => (j === i ? t : x)) });
  };
  const setExercise = (ti: number, ei: number, te: TemplateExercise) => setTemplate(ti, { ...plan.templates[ti], exercises: plan.templates[ti].exercises.map((x, j) => (j === ei ? te : x)) });
  const move = (ti: number, ei: number, dir: -1 | 1) => {
    const list = [...plan.templates[ti].exercises];
    const j = ei + dir;
    if (j < 0 || j >= list.length) return;
    [list[ei], list[j]] = [list[j], list[ei]];
    setTemplate(ti, { ...plan.templates[ti], exercises: list });
  };

  return (
    <Screen back title="Workout plan" subtitle="Starting values — not universal truths. Edit anything.">
      <Field label="Plan name">
        <TextInput value={plan.name} onChange={(v) => setPlan({ ...plan, name: v })} aria-label="Plan name" />
      </Field>
      {plan.templates.map((t, ti) => (
        <div key={t.id}>
          <SectionTitle
            action={
              <button type="button" className="hit-44 text-[13px] font-semibold text-danger" onClick={() => setPlan({ ...plan, templates: plan.templates.filter((_, j) => j !== ti) })}>
                Remove day
              </button>
            }
          >
            {t.name}
          </SectionTitle>
          <Card className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name">
                <TextInput value={t.name} onChange={(v) => setTemplate(ti, { ...t, name: v })} aria-label="Day name" />
              </Field>
              <Field label="Day">
                <Select value={t.weekday ?? -1} onChange={(v) => setTemplate(ti, { ...t, weekday: v === -1 ? null : v })} options={DAYS} aria-label="Weekday" />
              </Field>
            </div>
            <Field label="Estimated minutes">
              <NumberInput value={t.estimatedMin} onChange={(v) => setTemplate(ti, { ...t, estimatedMin: Math.max(10, Math.round(v)) })} aria-label="Estimated minutes" />
            </Field>
            <div className="divide-y divide-line">
              {t.exercises.map((te, ei) => (
                <div key={`${te.exerciseId}${ei}`} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[15px] font-semibold">{exName(te.exerciseId)}</span>
                    <button type="button" aria-label="Move up" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2" onClick={() => move(ti, ei, -1)}>
                      ↑
                    </button>
                    <button type="button" aria-label="Move down" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2" onClick={() => move(ti, ei, 1)}>
                      ↓
                    </button>
                    <button type="button" aria-label="Remove exercise" className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger" onClick={() => setTemplate(ti, { ...t, exercises: t.exercises.filter((_, j) => j !== ei) })}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    <Field label="Sets">
                      <NumberInput value={te.sets} onChange={(v) => setExercise(ti, ei, { ...te, sets: Math.max(1, Math.round(v)) })} aria-label="Sets" className="!h-11 !px-2" />
                    </Field>
                    <Field label="Min">
                      <NumberInput value={te.repMin} onChange={(v) => setExercise(ti, ei, { ...te, repMin: Math.max(1, Math.round(v)) })} aria-label="Min reps" className="!h-11 !px-2" />
                    </Field>
                    <Field label="Max">
                      <NumberInput value={te.repMax} onChange={(v) => setExercise(ti, ei, { ...te, repMax: Math.max(te.repMin, Math.round(v)) })} aria-label="Max reps" className="!h-11 !px-2" />
                    </Field>
                    <Field label="Rest s">
                      <NumberInput value={te.restSec} onChange={(v) => setExercise(ti, ei, { ...te, restSec: Math.max(0, Math.round(v)) })} aria-label="Rest seconds" className="!h-11 !px-2" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
            <Button block variant="secondary" icon="plus" onClick={() => setPicker(ti)}>
              Add exercise
            </Button>
          </Card>
        </div>
      ))}
      <Button
        block
        variant="secondary"
        icon="plus"
        className="mt-4"
        onClick={() => setPlan({ ...plan, templates: [...plan.templates, { id: uid('tpl_'), name: 'New day', weekday: null, exercises: [], estimatedMin: 45 }] })}
      >
        Add training day
      </Button>
      <Button
        block
        size="lg"
        className="mt-3"
        onClick={async () => {
          await savePlan(plan);
          await refresh();
          setSaved(true);
        }}
      >
        {saved ? 'Saved ✓' : 'Save plan'}
      </Button>
      <p className="mt-2 px-1 text-[12px] text-muted">Changes apply from the next scheduled day. Recovery between sets: 60–120 s is a good default.</p>

      <Sheet open={picker !== null} onClose={() => setPicker(null)} title="Add exercise">
        <div className="space-y-1.5">
          {data.exercises.map((e) => (
            <button
              key={e.id}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left shadow-card"
              onClick={() => {
                if (picker === null) return;
                const t = plan.templates[picker];
                setTemplate(picker, { ...t, exercises: [...t.exercises, { exerciseId: e.id, sets: e.defaultSets, repMin: e.repMin, repMax: e.repMax, restSec: e.restSec }] });
                setPicker(null);
              }}
            >
              <span className="text-[15px] font-semibold">{e.name}</span>
              <span className="text-[12px] text-muted capitalize">{e.category}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </Screen>
  );
}
