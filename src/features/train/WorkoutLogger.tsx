import { TextInput } from '@/components/ui/forms';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ExerciseIllustration } from '@/components/illustration/ExerciseIllustration';
import { MuscleMap } from '@/components/illustration/MuscleMap';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Chip, cx } from '@/components/ui/primitives';
import { Dialog, Sheet } from '@/components/ui/Sheet';
import { RPE_INFO } from '@/domain/progression';
import { useAsync } from '@/hooks';
import { workoutRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { haptics } from '@/services/haptics';
import { abandonSession, addExerciseToSession, decideSuggestion, type FinishSummary, finishSession, saveSession, startSession } from '@/services/workoutService';
import { useGame } from '@/store/gameStore';
import type { Exercise, Rpe, SessionExercise, SetLog, WorkoutSession } from '@/types';
import { formatInt } from '@/utils/format';
import { formatClock } from '../play/PlayTimeCard';

function NumBox({ value, onChange, step, label, suffix }: { value: number; onChange: (v: number) => void; step: number; label: string; suffix?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-xl bg-surface-2" role="group" aria-label={label}>
      <button type="button" className="hit-44 flex h-10 w-7 shrink-0 items-center justify-center text-muted" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(0, Math.round((value - step) * 100) / 100))}>
        <Icon name="minus" size={14} />
      </button>
      <input
        inputMode="decimal"
        aria-label={label}
        className="num h-10 w-full min-w-0 flex-1 bg-transparent text-center text-[16px] font-bold outline-none"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const v = parseFloat(e.target.value.replace(',', '.'));
          onChange(Number.isFinite(v) ? v : 0);
        }}
      />
      {suffix && <span className="-ml-1 shrink-0 text-[10px] text-muted">{suffix}</span>}
      <button type="button" className="hit-44 flex h-10 w-7 shrink-0 items-center justify-center text-muted" aria-label={`Increase ${label}`} onClick={() => onChange(Math.round((value + step) * 100) / 100)}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

function SetRow({ index, set, ex, def, onChange, onComplete }: { index: number; set: SetLog; ex: SessionExercise; def?: Exercise; onChange: (s: SetLog) => void; onComplete: () => void }) {
  const [rpeOpen, setRpeOpen] = useState(false);
  const time = def?.measure === 'time';
  const bodyweight = def?.bodyweight;
  return (
    <div className={cx('rounded-2xl p-2', set.completed ? 'bg-success/10' : 'bg-surface')}>
      <div className="flex items-center gap-1">
        <span className="num w-5 shrink-0 text-center text-[13px] font-bold text-muted">{index + 1}</span>
        {!bodyweight && <NumBox value={set.weight} onChange={(w) => onChange({ ...set, weight: w })} step={def?.progression.increment ?? 2.5} label={`Set ${index + 1} weight`} suffix="kg" />}
        <NumBox value={set.reps} onChange={(r) => onChange({ ...set, reps: Math.round(r) })} step={time ? 5 : 1} label={`Set ${index + 1} ${time ? 'seconds' : 'reps'}`} suffix={time ? 's' : '×'} />
        <button type="button" className="hit-44 h-10 w-10 shrink-0 rounded-xl bg-surface-2 text-[20px]" aria-label="Set difficulty" onClick={() => setRpeOpen((v) => !v)}>
          {set.rpe ? RPE_INFO[set.rpe].emoji : '🙂'}
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.85 }}
          aria-label={set.completed ? `Set ${index + 1} completed` : `Complete set ${index + 1}`}
          aria-pressed={set.completed}
          onClick={() => {
            const completed = !set.completed;
            onChange({ ...set, completed, rpe: set.rpe ?? 2 });
            if (completed) {
              haptics.success();
              onComplete();
            }
          }}
          className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', set.completed ? 'bg-success text-white' : 'border-2 border-line text-faint')}
        >
          <Icon name="check" size={20} strokeWidth={3} />
        </motion.button>
      </div>
      {rpeOpen && (
        <div className="mt-2 grid grid-cols-4 gap-1">
          {([1, 2, 3, 4] as Rpe[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange({ ...set, rpe: r });
                setRpeOpen(false);
              }}
              className={cx('flex flex-col items-center rounded-xl py-1.5 text-[11px] font-semibold', set.rpe === r ? 'bg-accent text-on-accent' : 'bg-surface-2')}
            >
              <span className="text-[20px]">{RPE_INFO[r].emoji}</span>
              {RPE_INFO[r].label}
            </button>
          ))}
        </div>
      )}
      {set.completed === false && index === 0 && ex.targetWeight > 0 && !bodyweight && set.weight !== ex.targetWeight && <div className="mt-1 pl-8 text-[11px] text-muted">Working weight: {ex.targetWeight} kg</div>}
    </div>
  );
}

export default function WorkoutLogger() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const act = useGame((s) => s.act);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const [now, setNow] = useState(() => clock.now());
  const [info, setInfo] = useState<Exercise | null>(null);
  const [picker, setPicker] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [summary, setSummary] = useState<FinishSummary | null>(null);
  const [finishing, setFinishing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { data: exercises } = useAsync(async () => new Map((await workoutRepository.exercises.all()).map((e) => [e.id, e])), [], { live: false });

  useEffect(() => {
    void startSession(params.get('template') || undefined, params.get('quest') || undefined).then(setSession);
  }, [params]);

  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      haptics.warning();
      setRest(null);
    }
  }, [now, rest]);

  const update = useCallback((next: WorkoutSession) => {
    setSession(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveSession(next), 400);
  }, []);

  if (!session || !exercises) {
    return <div className="flex h-full items-center justify-center pt-safe text-muted">Loading workout…</div>;
  }

  const setExercise = (i: number, ex: SessionExercise) => update({ ...session, exercises: session.exercises.map((e, j) => (j === i ? ex : e)) });
  const doneSets = session.exercises.flatMap((e) => e.sets).filter((s) => s.completed).length;
  const totalSets = session.exercises.flatMap((e) => e.sets).length;
  const volume = session.exercises.flatMap((e) => e.sets.filter((s) => s.completed)).reduce((s, x) => s + x.weight * x.reps, 0);

  const finish = async () => {
    setFinishing(true);
    clearTimeout(saveTimer.current);
    await saveSession(session);
    const r = await act(finishSession(session.id));
    setFinishing(false);
    if (r.summary) setSummary(r.summary);
  };

  return (
    <div className="min-h-full pb-[calc(var(--safe-bottom)+110px)]">
      <div className="sticky top-0 z-20 glass pt-safe">
        <div className="flex h-14 items-center gap-2 px-safe">
          <button type="button" className="-ml-2 flex h-11 w-11 items-center justify-center text-[16px] text-accent" aria-label="Quit workout" onClick={() => setConfirmQuit(true)}>
            <Icon name="close" size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[16px] font-bold">{session.name}</div>
            <div className="num text-[12px] text-muted">
              ⏱ {formatClock((now - session.startedAt) / 1000)} · {doneSets}/{totalSets} sets · {formatInt(volume)} kg
            </div>
          </div>
          <Button size="sm" onClick={() => void finish()} loading={finishing} disabled={doneSets === 0}>
            Finish
          </Button>
        </div>
      </div>

      <div className="space-y-3 px-safe pt-3">
        {session.exercises.map((ex, i) => {
          const def = exercises.get(ex.exerciseId);
          const done = ex.sets.filter((s) => s.completed).length;
          return (
            <Card key={`${ex.exerciseId}${i}`} className="!p-3">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => def && setInfo(def)} aria-label={`How to do ${def?.name}`} className="shrink-0 overflow-hidden rounded-2xl">
                  <ExerciseIllustration illustration={def?.illustration ?? ''} muscles={def?.muscles} size={78} mode="end" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[16px] font-bold">{def?.name ?? ex.exerciseId}</span>
                    {done >= ex.targetSets && <span>✅</span>}
                  </div>
                  <div className="num text-[13px] text-muted">
                    {ex.targetSets} × {ex.repMin === ex.repMax ? ex.repMin : `${ex.repMin}–${ex.repMax}`}
                    {def?.measure === 'time' ? ' s' : ''}
                    {!def?.bodyweight && ex.targetWeight > 0 ? ` · ${ex.targetWeight} kg` : ''} · rest {ex.restSec}s
                  </div>
                  {def?.notes && <div className="text-[12px] text-muted">{def.notes}</div>}
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                {ex.sets.map((set, si) => (
                  <SetRow
                    key={si}
                    index={si}
                    set={set}
                    ex={ex}
                    def={def}
                    onChange={(s) => {
                      const sets = ex.sets.map((x, k) => (k === si ? s : x));
                      // Carry weight changes forward to the following untouched sets.
                      if (s.weight !== set.weight) for (let k = si + 1; k < sets.length; k++) if (!sets[k].completed) sets[k] = { ...sets[k], weight: s.weight };
                      setExercise(i, { ...ex, sets });
                    }}
                    onComplete={() => setRest({ endsAt: clock.now() + ex.restSec * 1000, total: ex.restSec })}
                  />
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" icon="plus" onClick={() => setExercise(i, { ...ex, sets: [...ex.sets, { ...(ex.sets.at(-1) ?? { weight: ex.targetWeight, reps: ex.repMax }), completed: false, rpe: undefined }] })}>
                  Set
                </Button>
                {ex.sets.length > 1 && (
                  <Button size="sm" variant="secondary" icon="minus" onClick={() => setExercise(i, { ...ex, sets: ex.sets.slice(0, -1) })}>
                    Set
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
        <Button block variant="secondary" icon="plus" onClick={() => setPicker(true)}>
          Add exercise
        </Button>
        <TextInput voice value={session.notes ?? ''} onChange={(v) => update({ ...session, notes: v.slice(0, 300) || undefined })} placeholder="Session notes (how it felt, pain, gym busy…)" aria-label="Session notes" />
      </div>

      <AnimatePresence>
        {rest && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(var(--safe-bottom)+12px)]">
            <div className="mx-auto flex max-w-[560px] items-center gap-3 rounded-3xl bg-fg p-3 text-bg shadow-float">
              <div className="flex-1">
                <div className="text-[12px] font-bold tracking-widest opacity-70">REST</div>
                <div className="num text-[26px] font-extrabold">{formatClock((rest.endsAt - now) / 1000)}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg/20">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, ((rest.endsAt - now) / 1000 / rest.total) * 100)}%` }} />
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setRest({ ...rest, endsAt: rest.endsAt + 15000, total: rest.total + 15 })}>
                +15s
              </Button>
              <Button size="sm" onClick={() => setRest(null)}>
                Skip
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={!!info} onClose={() => setInfo(null)} title={info?.name}>
        {info && (
          <div>
            <ExerciseIllustration illustration={info.illustration} muscles={info.muscles} size={320} mode="animate" className="flex justify-center" />
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[14px]">
              {info.instructions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div className="mt-4">
              <MuscleMap muscles={info.muscles} height={170} />
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Add exercise">
        <div className="space-y-2">
          {[...exercises.values()].map((e) => (
            <button
              key={e.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl bg-surface p-2 text-left shadow-card"
              onClick={async () => {
                const next = await addExerciseToSession(session, e);
                setSession(next);
                setPicker(false);
              }}
            >
              <ExerciseIllustration illustration={e.illustration} muscles={e.muscles} size={56} mode="end" />
              <span className="flex-1 text-[15px] font-semibold">{e.name}</span>
              <Chip>{e.category}</Chip>
            </button>
          ))}
        </div>
      </Sheet>

      <Dialog
        open={confirmQuit}
        title="Leave workout?"
        message="Progress is saved. You can resume it from Train, or discard it."
        confirmLabel="Discard"
        cancelLabel="Keep"
        destructive
        onCancel={() => {
          setConfirmQuit(false);
          navigate('/train');
        }}
        onConfirm={async () => {
          await abandonSession(session.id);
          setConfirmQuit(false);
          navigate('/train');
        }}
      />

      <Sheet open={!!summary} onClose={() => navigate('/train')} title="Workout complete 💪" full>
        {summary && <SessionSummary summary={summary} exercises={exercises} onDone={() => navigate('/train')} />}
      </Sheet>
    </div>
  );
}

function SessionSummary({ summary, exercises, onDone }: { summary: FinishSummary; exercises: Map<string, Exercise>; onDone: () => void }) {
  const [session, setSession] = useState(summary.session);
  const decide = async (exerciseId: string, accept: boolean) => {
    const next = await decideSuggestion(session.id, exerciseId, accept);
    if (next) setSession(next);
  };
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Sets', `${summary.completedSets}/${summary.totalSets}`],
          ['Volume', `${formatInt(summary.volume)} kg`],
          ['Time', `${summary.durationMin} min`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-surface p-3 shadow-card">
            <div className="text-[12px] text-muted">{k}</div>
            <div className="num text-[18px] font-extrabold">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 mb-2 text-[13px] font-bold tracking-wide text-muted uppercase">Next session suggestions</div>
      <p className="mb-3 text-[13px] text-muted">Nothing changes unless you say YES.</p>
      <div className="space-y-2">
        {session.exercises
          .filter((e) => e.suggestion && e.suggestion.action !== 'none')
          .map((e) => {
            const s = e.suggestion!;
            const def = exercises.get(e.exerciseId);
            const change = s.action === 'increase' || s.action === 'decrease' || s.action === 'deload';
            return (
              <Card key={e.exerciseId} className="!p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold">{def?.name}</span>
                  <Chip color={s.action === 'increase' ? '#30d158' : s.action === 'maintain' || s.action === 'increase_reps' ? '#0a84ff' : '#ff9f0a'}>{s.action.replace('_', ' ')}</Chip>
                </div>
                <div className="num mt-1 text-[13px]">
                  <span className="text-muted">CURRENT</span> {s.currentWeight} kg → <span className="text-muted">NEXT</span>{' '}
                  <span className="font-bold">
                    {s.nextWeight} kg · {s.repMin}–{s.repMax}
                  </span>
                </div>
                <div className="mt-1 text-[13px] text-muted">{s.reason}</div>
                {e.decision ? (
                  <div className={cx('mt-2 text-[13px] font-semibold', e.decision === 'accepted' ? 'text-success' : 'text-muted')}>{e.decision === 'accepted' ? '✓ Applied for next session' : 'Kept as is'}</div>
                ) : (
                  (change || s.action === 'increase_reps') && (
                    <div className="mt-2">
                      <div className="mb-1.5 text-[13px] font-semibold">{s.action === 'increase' ? 'Increase weight next session?' : s.action === 'increase_reps' ? 'Update the rep target?' : 'Apply this change?'}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void decide(e.exerciseId, false)}>
                          NO
                        </Button>
                        <Button size="sm" onClick={() => void decide(e.exerciseId, true)}>
                          YES
                        </Button>
                      </div>
                    </div>
                  )
                )}
              </Card>
            );
          })}
      </div>
      <Button block size="lg" className="mt-5" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
