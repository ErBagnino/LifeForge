import { useState } from 'react';
import { ExerciseIllustration } from '@/components/illustration/ExerciseIllustration';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Toggle } from '@/components/ui/forms';
import { Button, Card, SectionTitle, cx } from '@/components/ui/primitives';
import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';
import { RPE_INFO } from '@/domain/progression';
import { useAsync } from '@/hooks';
import { workoutRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { logCardio } from '@/services/workoutService';
import { useGame } from '@/store/gameStore';
import type { Rpe } from '@/types';
import { formatDate, weekEnd, weekStart } from '@/utils/date';
import { SuggestionCards } from '../today/SuggestionCards';

export default function CardioScreen() {
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const stageIndex = settings?.cardio.stageIndex ?? 0;
  const stage = DEFAULT_CARDIO_STAGES[Math.min(stageIndex, DEFAULT_CARDIO_STAGES.length - 1)];
  const [duration, setDuration] = useState(stage.durationMin);
  const [distance, setDistance] = useState(0);
  const [difficulty, setDifficulty] = useState<Rpe>(2);
  const [completed, setCompleted] = useState(true);
  const today = clock.today();
  const { data: sessions } = useAsync(async () => (await workoutRepository.sessionsRange(weekStart(today), weekEnd(today))).filter((s) => s.kind === 'cardio'), [today]);
  if (!settings) return null;
  const illustration = stage.intensity === 'walk' ? 'brisk_walk' : 'light_jog';

  return (
    <Screen back title="Cardio program" subtitle="Walk → intervals → light running. One stage per week at most, only when it feels manageable.">
      <SuggestionCards />
      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <ExerciseIllustration illustration={illustration} size={110} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-muted">
              STAGE {stageIndex + 1} OF {DEFAULT_CARDIO_STAGES.length}
            </div>
            <div className="text-[20px] font-extrabold">{stage.name}</div>
            <div className="text-[13px] text-muted">{stage.description}</div>
            {stage.structure && <div className="mt-1 text-[13px] font-semibold">{stage.structure}</div>}
            <div className="num mt-1 text-[12px] text-muted">
              {sessions?.filter((s) => s.cardio?.completed).length ?? 0}/{stage.sessionsPerWeek} this week
            </div>
          </div>
        </div>
      </Card>

      <SectionTitle>Log a session</SectionTitle>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Duration (min)">
            <NumberInput value={duration} onChange={setDuration} min={1} aria-label="Duration" />
          </Field>
          <Field label="Distance (km)">
            <NumberInput value={distance} onChange={setDistance} min={0} step={0.1} placeholder="optional" aria-label="Distance" />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 px-1 text-[13px] font-semibold text-muted">How did it feel?</div>
          <div className="grid grid-cols-4 gap-1.5">
            {([1, 2, 3, 4] as Rpe[]).map((r) => (
              <button key={r} type="button" onClick={() => setDifficulty(r)} className={cx('flex flex-col items-center rounded-2xl py-2 text-[11px] font-semibold', difficulty === r ? 'bg-accent text-on-accent' : 'bg-surface-2')}>
                <span className="text-[22px]">{RPE_INFO[r].emoji}</span>
                {RPE_INFO[r].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[15px]">Completed the planned session</span>
          <Toggle checked={completed} onChange={setCompleted} label="Completed" />
        </div>
        <Button block size="lg" onClick={() => void act(logCardio({ stageId: stage.id, durationMin: duration, distanceKm: distance || undefined, difficulty, completed }))}>
          Log session
        </Button>
      </Card>

      <SectionTitle>The path</SectionTitle>
      <div className="space-y-1.5">
        {DEFAULT_CARDIO_STAGES.map((s, i) => (
          <div key={s.id} className={cx('flex items-center gap-3 rounded-2xl px-4 py-2.5', i === stageIndex ? 'bg-accent/12' : 'bg-surface shadow-card', i > stageIndex && 'opacity-60')}>
            <span className="num w-6 text-[13px] font-bold text-muted">{i + 1}</span>
            <span className="flex-1 text-[14px] font-semibold">{s.name}</span>
            <span className="text-[12px] text-muted">{i < stageIndex ? '✓' : i === stageIndex ? 'current' : `${s.durationMin}′`}</span>
          </div>
        ))}
      </div>
      {!!sessions?.length && (
        <>
          <SectionTitle>This week</SectionTitle>
          <Card className="space-y-1.5">
            {sessions.map((s) => (
              <div key={s.id} className="flex justify-between text-[14px]">
                <span>{formatDate(s.date, 'EEE d')}</span>
                <span className="num text-muted">
                  {s.cardio?.durationMin} min {s.cardio?.distanceKm ? `· ${s.cardio.distanceKm} km` : ''} {s.cardio ? RPE_INFO[s.cardio.difficulty].emoji : ''}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
      <p className="mt-3 px-1 text-[12px] text-muted">Progression never jumps more than your safety cap ({settings.safety.maxCardioIncreasePct}% per step) and steps back after hard or light weeks.</p>
    </Screen>
  );
}
