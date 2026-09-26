import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Ring } from '@/components/ui/progress';
import { Button, Card, Kpi, SectionTitle } from '@/components/ui/primitives';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { scoreGrade } from '@/domain/score';
import { useAsync } from '@/hooks';
import { markReviewed } from '@/services/adminService';
import { clock } from '@/services/clock';
import { resolveText } from '@/services/game/questFactory';
import { dailyRecap } from '@/services/insightsService';
import { useGame } from '@/store/gameStore';
import { formatDate } from '@/utils/date';
import { formatInt, formatMl } from '@/utils/format';

export default function DailyRecap() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const player = useGame((s) => s.player);
  const act = useGame((s) => s.act);
  const today = clock.today();
  const { data } = useAsync(() => dailyRecap(today), [today]);

  useEffect(() => {
    void act(markReviewed('daily'));
  }, [act]);

  if (!data || !settings || !player) return null;
  const { log, quests, achievements, sessions, tomorrow } = data;
  const m = log?.metrics ?? {};
  const completed = quests.filter((q) => q.status === 'completed');
  const pet = settings.profile.petName;
  const n = settings.nutrition;
  const leftover = quests.filter((q) => q.status === 'pending' && !q.hidden && !q.goal);

  return (
    <Screen back title="Daily recap" subtitle={formatDate(today, 'EEEE d MMMM')}>
      <Card className="mt-3 flex items-center gap-4">
        <Ring value={(log?.score ?? 0) / 100} size={110} stroke={11}>
          <span className="num text-[34px] font-extrabold">{log?.score ?? 0}</span>
          <span className="text-[10px] font-bold text-muted">SCORE · {scoreGrade(log?.score ?? 0)}</span>
        </Ring>
        <div className="flex-1 space-y-1 text-[14px]">
          <div>
            <span className="num font-bold text-xp">+{formatInt(log?.xp ?? 0)} XP</span> · <span className="num font-bold text-coin">+{formatInt(log?.coins ?? 0)} 🪙</span>
          </div>
          <div>
            {log?.core.done ?? 0}/{log?.core.total ?? 0} core · {completed.length}/{quests.filter((q) => q.status !== 'moved').length} quests
          </div>
          <div>🔥 Streak {player.streak.current}</div>
          {achievements.length > 0 && <div>🏅 {achievements.length} achievement{achievements.length > 1 ? 's' : ''}</div>}
        </div>
      </Card>

      <SectionTitle>Body</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Steps" value={formatInt(m.steps ?? 0)} sub={`/ ${formatInt(settings.steps.ideal)}`} icon="👟" />
        <Kpi label="Water" value={formatMl(m.water ?? 0)} sub={`/ ${formatMl(settings.hydration.targetMl)}`} icon="💧" />
        <Kpi label="Play time" value={`${Math.round(m.leisure ?? 0)}m`} sub={`/ ${settings.leisure.dailyLimitMin}m`} icon="🎮" />
        <Kpi label="Calories" value={formatInt(m.calories ?? 0)} sub={`/ ${formatInt(n.calories)}`} icon="🔥" />
        <Kpi label="Protein" value={`${formatInt(m.protein ?? 0)} g`} sub={`/ ${n.protein} g`} icon="🥩" />
        <Kpi label="Sleep" value={m.sleep ? `${m.sleep}h` : '—'} icon="😴" />
      </div>

      {sessions.length > 0 && (
        <>
          <SectionTitle>Workout</SectionTitle>
          {sessions.map((s) => (
            <Card key={s.id} className="mb-2 !p-3 text-[14px]">
              {s.kind === 'cardio' ? '🏃' : '🏋️'} <span className="font-semibold">{s.name}</span> ·{' '}
              {s.kind === 'cardio' ? `${s.cardio?.durationMin} min` : `${s.exercises.flatMap((e) => e.sets.filter((x) => x.completed)).length} sets · ${formatInt(s.exercises.flatMap((e) => e.sets.filter((x) => x.completed)).reduce((sum, x) => sum + x.weight * x.reps, 0))} kg`}
            </Card>
          ))}
        </>
      )}

      {achievements.length > 0 && (
        <>
          <SectionTitle>Achievements</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {achievements.map((a) => (
              <span key={a.id} className="rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-card">
                {a.icon} {resolveText(a.name, pet)}
              </span>
            ))}
          </div>
        </>
      )}

      {leftover.length > 0 && (
        <>
          <SectionTitle>Still open</SectionTitle>
          <Card className="space-y-1.5">
            {leftover.slice(0, 8).map((q) => (
              <div key={q.id} className="flex items-center gap-2 text-[14px]">
                <span>{q.icon}</span>
                <span className="flex-1 truncate">{resolveText(q.title, pet)}</span>
                <span className="text-[11px] font-semibold text-muted uppercase">{q.tier}</span>
              </div>
            ))}
            <p className="pt-1 text-[12px] text-muted">There’s still time. Or let it go and win tomorrow — no spiral, just a new run.</p>
          </Card>
        </>
      )}

      <SectionTitle>Tomorrow</SectionTitle>
      {tomorrow ? (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[16px] font-bold">
                {tomorrow.dayType === 'work' ? '💼 Workday' : tomorrow.dayType === 'rest' ? '🛌 Rest day' : '🌤️ Free day'}
                {tomorrow.workout ? ` · 🏋️ ${tomorrow.workout}` : ''}
              </div>
              <div className="text-[13px] text-muted">
                ~{tomorrow.questCount} scheduled quests · workload {tomorrow.workload.score} ({tomorrow.workload.level})
              </div>
            </div>
            <span className="text-[28px]">{tomorrow.workload.level === 'high' ? DIFFICULTY_STATE_INFO.overloaded.icon : tomorrow.workload.level === 'low' ? '🌶️' : '⚖️'}</span>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {tomorrow.workload.level === 'high' ? 'Heavy day ahead: side quests will be trimmed. Prep clothes and food tonight.' : tomorrow.workload.level === 'low' ? 'Light day ahead: expect bonus quests.' : 'Balanced day ahead.'}
          </p>
        </Card>
      ) : (
        <div className="text-[13px] text-muted">—</div>
      )}
      <Button block size="lg" className="mt-5" onClick={() => navigate('/')}>
        Back to today
      </Button>
    </Screen>
  );
}
