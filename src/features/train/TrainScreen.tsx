import { useNavigate } from 'react-router';
import { MuscleMap } from '@/components/illustration/MuscleMap';
import { Screen } from '@/components/layout/Screen';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, EmptyState, Kpi, SectionTitle, cx } from '@/components/ui/primitives';
import { DEFAULT_CARDIO_STAGES } from '@/data/cardio';
import { useAsync } from '@/hooks';
import { statsRepository, workoutRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { sessionStats } from '@/services/workoutService';
import { useGame } from '@/store/gameStore';
import type { MuscleTarget } from '@/types';
import { formatDate, shiftDate, weekday, weekEnd, weekStart } from '@/utils/date';
import { formatInt } from '@/utils/format';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TrainScreen() {
  const navigate = useNavigate();
  const today = useGame((s) => s.today);
  const settings = useGame((s) => s.settings);
  const date = clock.today();
  const { data } = useAsync(async () => {
    const [plan, exercises, active, week, recent, records] = await Promise.all([
      workoutRepository.activePlan(),
      workoutRepository.exercises.all(),
      workoutRepository.activeSession(),
      workoutRepository.sessionsRange(weekStart(date), weekEnd(date)),
      workoutRepository.recentSessions(6),
      statsRepository.records(),
    ]);
    return { plan, exercises: new Map(exercises.map((e) => [e.id, e])), active, week, recent, records };
  }, [date]);

  if (!data || !settings) return null;
  const { plan, exercises, active, week, recent, records } = data;
  const todays = plan?.templates.find((t) => t.weekday === weekday(date));
  const questToday = today?.quests.find((q) => q.kind === 'workout');
  const doneToday = questToday?.status === 'completed' || week.some((s) => s.date === date && s.status === 'completed' && s.kind === 'strength');
  const nextTemplate = plan?.templates
    .filter((t) => t.weekday !== null)
    .map((t) => ({ t, diff: ((t.weekday! - weekday(date) + 7) % 7) || 7 }))
    .sort((a, b) => a.diff - b.diff)[0];
  const featured = todays ?? nextTemplate?.t;
  const muscles: MuscleTarget[] = featured ? featured.exercises.flatMap((te) => exercises.get(te.exerciseId)?.muscles ?? []) : [];
  const stage = DEFAULT_CARDIO_STAGES[Math.min(settings.cardio.stageIndex, DEFAULT_CARDIO_STAGES.length - 1)];
  const cardioThisWeek = week.filter((s) => s.kind === 'cardio' && s.cardio?.completed).length;
  const prs = records.filter((r) => r.kind === 'exercise_weight').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);

  return (
    <Screen hud>
      <div className="mt-4 flex items-end justify-between">
        <h1 className="text-[30px] leading-tight font-extrabold tracking-tight">Train</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => navigate('/train/exercises')}>
            Exercises
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/train/plan')}>
            Plan
          </Button>
        </div>
      </div>

      {active ? (
        <Card className="mt-4 border-2 border-accent/50">
          <div className="text-[12px] font-extrabold tracking-widest text-accent">WORKOUT IN PROGRESS</div>
          <div className="mt-1 text-[20px] font-bold">{active.name}</div>
          <Button block size="lg" className="mt-3" icon="play" onClick={() => navigate('/train/workout')}>
            Resume
          </Button>
        </Card>
      ) : featured ? (
        <Card className="mt-4">
          <div className="text-[12px] font-extrabold tracking-widest text-muted">{todays ? (doneToday ? 'DONE TODAY ✓' : 'TODAY') : `NEXT · ${DAY[featured.weekday ?? 0].toUpperCase()}`}</div>
          <div className="mt-1 text-[24px] font-extrabold">{featured.name}</div>
          <div className="text-[14px] text-muted">
            {featured.exercises.length} exercises · ~{featured.estimatedMin} min · rest 60–120 s
          </div>
          <div className="mt-3">
            <MuscleMap muscles={muscles} height={150} showLegend={false} />
          </div>
          <div className="mt-3 space-y-1">
            {featured.exercises.map((te) => {
              const ex = exercises.get(te.exerciseId);
              return (
                <button key={te.exerciseId} type="button" onClick={() => navigate(`/train/exercise/${te.exerciseId}`)} className="flex w-full items-center justify-between rounded-xl px-1 py-1.5 text-left text-[14px] active:bg-surface-2">
                  <span className="font-medium">{ex?.name ?? te.exerciseId}</span>
                  <span className="num text-muted">
                    {te.sets} × {te.repMin === te.repMax ? te.repMin : `${te.repMin}–${te.repMax}`}
                    {ex?.measure === 'time' ? ' s' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            block
            size="lg"
            className="mt-4"
            icon="play"
            variant={doneToday ? 'secondary' : 'primary'}
            onClick={() => navigate(`/train/workout?template=${featured.id}${questToday && todays ? `&quest=${questToday.id}` : ''}`)}
          >
            {doneToday ? 'Train again (extra)' : todays ? 'START WORKOUT' : 'Start it today anyway'}
          </Button>
        </Card>
      ) : (
        <EmptyState icon="📋" title="No workout plan" body="Create a plan to get scheduled workout quests." action={<Button onClick={() => navigate('/train/plan')}>Edit plan</Button>} />
      )}

      <SectionTitle>This week</SectionTitle>
      <div className="grid grid-cols-7 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const t = plan?.templates.find((x) => x.weekday === d);
          const iso = shiftDate(weekStart(date), (d + 6) % 7);
          const done = week.some((s) => s.date === iso && s.status === 'completed' && s.kind === 'strength');
          const isToday = d === weekday(date);
          return (
            <div key={d} className={cx('flex flex-col items-center rounded-2xl py-2', isToday ? 'bg-accent/12' : 'bg-surface shadow-card')}>
              <span className="text-[11px] font-bold text-muted">{DAY[d]}</span>
              <span className="mt-1 text-[16px]">{done ? '✅' : t ? '🏋️' : '·'}</span>
              <span className="mt-0.5 line-clamp-1 px-0.5 text-[9px] font-semibold text-muted">{t?.name.split(' ')[0] ?? 'rest'}</span>
            </div>
          );
        })}
      </div>

      {settings.cardio.enabled && (
        <>
          <SectionTitle>Cardio program</SectionTitle>
          <Card onClick={() => navigate('/train/cardio')}>
            <div className="flex items-center gap-3">
              <span className="text-[32px]">{stage.intensity === 'run' ? '🏃' : stage.intensity === 'intervals' ? '🏃‍♂️' : '🚶'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-muted">
                  STAGE {settings.cardio.stageIndex + 1}/{DEFAULT_CARDIO_STAGES.length}
                </div>
                <div className="text-[16px] font-bold">{stage.name}</div>
                <ProgressBar value={cardioThisWeek / stage.sessionsPerWeek} className="mt-1.5" color="var(--lf-energy)" />
                <div className="num mt-1 text-[12px] text-muted">
                  {cardioThisWeek}/{stage.sessionsPerWeek} sessions this week
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {prs.length > 0 && (
        <>
          <SectionTitle action={<button type="button" className="text-[13px] font-semibold text-accent" onClick={() => navigate('/stats/records')}>All</button>}>Latest PRs</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            {prs.map((r) => (
              <Kpi key={r.id} label={r.label.split(' · ')[0]} value={`${r.value} kg`} sub={formatDate(r.date, 'd MMM')} icon="🏆" />
            ))}
          </div>
        </>
      )}

      <SectionTitle>Recent sessions</SectionTitle>
      {!recent.length && <div className="rounded-3xl bg-surface-2 px-4 py-3 text-[13px] text-muted">No sessions yet. Your first one sets every baseline.</div>}
      <div className="space-y-2">
        {recent.map((s) => {
          const st = sessionStats(s);
          return (
            <Card key={s.id} className="!p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[15px] font-semibold">{s.kind === 'cardio' ? '🏃 ' : '🏋️ '}{s.name}</div>
                  <div className="text-[12px] text-muted">{formatDate(s.date, 'EEE d MMM')}</div>
                </div>
                <div className="num text-right text-[12px] text-muted">
                  {s.kind === 'cardio' ? `${s.cardio?.durationMin ?? 0} min` : `${st.sets} sets · ${formatInt(st.volume)} kg`}
                  <div>{st.durationMin ? `${st.durationMin} min` : ''}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}
