import { useState } from 'react';
import { useParams } from 'react-router';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExerciseIllustration } from '@/components/illustration/ExerciseIllustration';
import { MuscleMap } from '@/components/illustration/MuscleMap';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Segmented, Toggle } from '@/components/ui/forms';
import { Button, Card, Chip, EmptyState, SectionTitle } from '@/components/ui/primitives';
import { analyzeExercise, estimated1RM, suggestProgression } from '@/domain/progression';
import { useAsync } from '@/hooks';
import { settingsRepository, workoutRepository } from '@/repositories';
import { saveExercise } from '@/services/adminService';
import { exerciseHistory, setWorkingWeight } from '@/services/workoutService';
import type { Exercise } from '@/types';
import { formatDate } from '@/utils/date';

export default function ExerciseDetail() {
  const { id = '' } = useParams();
  const [mode, setMode] = useState<'animate' | 'pair'>('animate');
  const { data, reload } = useAsync(async () => {
    const [ex, state, history, settings] = await Promise.all([workoutRepository.exercises.get(id), workoutRepository.states.get(id), exerciseHistory(id, 20), settingsRepository.get()]);
    return { ex, state, history, settings };
  }, [id]);
  if (!data) return null;
  const { ex, state, history, settings } = data;
  if (!ex) return <Screen back title="Not found"><EmptyState icon="🤷" title="Exercise not found" /></Screen>;

  const chart = [...history].reverse().map((h) => {
    const best = h.sets.filter((s) => s.completed).reduce((m, s) => Math.max(m, estimated1RM(s.weight || 1, s.reps)), 0);
    return { date: formatDate(h.date, 'd/M'), weight: h.weight, e1rm: Math.round(best * 10) / 10 };
  });
  const suggestion = settings
    ? suggestProgression({ measure: ex.measure, bodyweight: !!ex.bodyweight, current: { weight: state?.workingWeight ?? 0, repMin: state?.repMin ?? ex.repMin, repMax: state?.repMax ?? ex.repMax }, history, rule: ex.progression, maxIncreasePct: settings.safety.maxTrainingIncreasePct })
    : undefined;

  return (
    <Screen back title={ex.name} subtitle={ex.equipment}>
      <Card className="mt-3">
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'animate', label: '▶︎ Motion' }, { value: 'pair', label: 'Start / Finish' }]} />
        <div className="mt-3 flex justify-center">
          <ExerciseIllustration illustration={ex.illustration} muscles={ex.muscles} size={mode === 'pair' ? 150 : 300} mode={mode} />
        </div>
      </Card>
      <SectionTitle>How to</SectionTitle>
      <Card>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px]">
          {ex.instructions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {ex.notes && <p className="mt-2 text-[13px] text-muted">{ex.notes}</p>}
      </Card>
      <SectionTitle>Muscles</SectionTitle>
      <Card>
        <MuscleMap muscles={ex.muscles} height={200} />
      </Card>

      <SectionTitle>Your numbers</SectionTitle>
      <WorkingLoad ex={ex} weight={state?.workingWeight ?? 0} repMin={state?.repMin ?? ex.repMin} repMax={state?.repMax ?? ex.repMax} onSaved={reload} />
      {suggestion && suggestion.action !== 'none' && (
        <Card className="mt-2">
          <div className="text-[12px] font-extrabold tracking-widest text-accent">PROGRESSION ENGINE</div>
          <div className="mt-1 text-[14px]">{suggestion.reason}</div>
        </Card>
      )}
      {chart.length > 1 ? (
        <Card className="mt-2">
          <div className="mb-2 text-[13px] font-semibold text-muted">Weight & estimated 1RM</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--lf-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--lf-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--lf-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', background: 'var(--lf-surface)' }} />
                <Line type="monotone" dataKey="weight" stroke="var(--lf-accent)" strokeWidth={2.5} dot={false} name="Weight" />
                <Line type="monotone" dataKey="e1rm" stroke="var(--lf-xp)" strokeWidth={2} dot={false} name="e1RM" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : (
        <p className="mt-2 px-1 text-[13px] text-muted">Log a few sessions to see the trend.</p>
      )}
      {history.length > 0 && (
        <>
          <SectionTitle>History</SectionTitle>
          <div className="space-y-2">
            {history.slice(0, 8).map((h, i) => {
              const a = analyzeExercise(h);
              return (
                <Card key={i} className="!p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold">{formatDate(h.date, 'EEE d MMM')}</span>
                    <Chip color={a.failure ? '#ff9f0a' : '#30d158'}>{a.failure ? 'tough' : 'clean'}</Chip>
                  </div>
                  <div className="num mt-1 text-[13px] text-muted">
                    {h.sets.filter((s) => s.completed).map((s) => `${ex.bodyweight ? '' : `${s.weight}×`}${s.reps}`).join(' · ')}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      <ProgressionRules ex={ex} onSaved={reload} />
    </Screen>
  );
}

function WorkingLoad({ ex, weight, repMin, repMax, onSaved }: { ex: Exercise; weight: number; repMin: number; repMax: number; onSaved: () => void }) {
  const [w, setW] = useState(weight);
  const [min, setMin] = useState(repMin);
  const [max, setMax] = useState(repMax);
  const dirty = w !== weight || min !== repMin || max !== repMax;
  return (
    <Card>
      <div className="grid grid-cols-3 gap-2">
        {!ex.bodyweight && (
          <Field label="Working kg">
            <NumberInput value={w} onChange={setW} step={0.5} aria-label="Working weight" />
          </Field>
        )}
        <Field label={ex.measure === 'time' ? 'Min sec' : 'Min reps'}>
          <NumberInput value={min} onChange={setMin} aria-label="Minimum reps" />
        </Field>
        <Field label={ex.measure === 'time' ? 'Max sec' : 'Max reps'}>
          <NumberInput value={max} onChange={setMax} aria-label="Maximum reps" />
        </Field>
      </div>
      {dirty && (
        <Button
          block
          className="mt-3"
          onClick={async () => {
            await setWorkingWeight(ex.id, w, min, max);
            onSaved();
          }}
        >
          Save
        </Button>
      )}
    </Card>
  );
}

function ProgressionRules({ ex, onSaved }: { ex: Exercise; onSaved: () => void }) {
  const [rule, setRule] = useState(ex.progression);
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionTitle action={<button type="button" className="hit-44 text-[13px] font-semibold text-accent" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Edit'}</button>}>Progression rules</SectionTitle>
      {open && (
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={ex.measure === 'time' ? 'Step (sec)' : 'Weight step (kg)'}>
              <NumberInput value={rule.increment} onChange={(v) => setRule({ ...rule, increment: v })} step={0.5} aria-label="Increment" />
            </Field>
            <Field label="Max increase %">
              <NumberInput value={rule.maxIncreasePct} onChange={(v) => setRule({ ...rule, maxIncreasePct: v })} aria-label="Max increase percent" />
            </Field>
            <Field label="Increase if RPE ≤ (1–4)">
              <NumberInput value={rule.easyRpeMax} onChange={(v) => setRule({ ...rule, easyRpeMax: Math.min(4, Math.max(1, Math.round(v))) as 1 | 2 | 3 | 4 })} aria-label="Easy RPE max" />
            </Field>
            <Field label="Fails before deload">
              <NumberInput value={rule.failuresBeforeDeload} onChange={(v) => setRule({ ...rule, failuresBeforeDeload: Math.max(2, Math.round(v)) })} aria-label="Failures before deload" />
            </Field>
            <Field label="Deload %">
              <NumberInput value={rule.deloadPct} onChange={(v) => setRule({ ...rule, deloadPct: v })} aria-label="Deload percent" />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px]">Require all sets completed</span>
            <Toggle checked={rule.requireAllSets} onChange={(v) => setRule({ ...rule, requireAllSets: v })} label="Require all sets" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[14px]">Require top of rep range</span>
            <Toggle checked={rule.requireTopOfRange} onChange={(v) => setRule({ ...rule, requireTopOfRange: v })} label="Require top of range" />
          </div>
          <Button
            block
            onClick={async () => {
              await saveExercise({ ...ex, progression: rule });
              onSaved();
            }}
          >
            Save rules
          </Button>
        </Card>
      )}
    </>
  );
}
