import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, EmptyState } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { activityRepository, routineRepository } from '@/repositories';
import { startRoutine } from '@/services/adminService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';

export default function RoutinesScreen() {
  const navigate = useNavigate();
  const today = useGame((s) => s.today);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const act = useGame((s) => s.act);
  const { data } = useAsync(async () => {
    const [routines, activities] = await Promise.all([routineRepository.all(), activityRepository.all()]);
    return { routines, activities: new Map(activities.map((a) => [a.id, a])) };
  }, []);
  if (!data || !today) return null;
  return (
    <Screen back title="Routines" subtitle="Collections of quests. Complete a whole routine for a bonus." right={<Button size="sm" variant="ghost" onClick={() => navigate('/admin/routines')}>Edit</Button>}>
      {!data.routines.length && <EmptyState icon="🌅" title="No routines" body="Create one in Admin → Routines." />}
      <div className="mt-3 space-y-3">
        {data.routines.map((r) => {
          const items = r.activityIds.map((id) => ({ id, activity: data.activities.get(id), quest: today.quests.find((q) => q.activityId === id && q.status !== 'moved') }));
          const scheduled = items.filter((i) => i.quest);
          const done = scheduled.filter((i) => i.quest?.status === 'completed').length;
          const complete = today.log?.routinesDone?.includes(r.id);
          return (
            <Card key={r.id}>
              <div className="flex items-center gap-3">
                <span className="text-[34px]">{r.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-bold">{r.name}</div>
                  <div className="num text-[12px] text-muted">
                    {r.startTime ? `from ${r.startTime} · ` : ''}bonus +{r.bonusXp} XP +{r.bonusCoins} 🪙
                  </div>
                </div>
                {complete && <span className="text-[22px]">✅</span>}
              </div>
              {scheduled.length > 0 && <ProgressBar value={done / scheduled.length} className="mt-3" color={complete ? 'var(--lf-success)' : undefined} />}
              <ul className="mt-3 space-y-1.5">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-[14px]">
                    <span className="w-5 text-center">{i.quest?.status === 'completed' ? '✅' : i.quest ? '⬜' : '·'}</span>
                    <span>{i.activity?.icon}</span>
                    <span className={i.quest ? '' : 'text-muted'}>{i.activity ? resolveText(i.activity.name, pet) : i.id}</span>
                  </li>
                ))}
              </ul>
              {items.some((i) => !i.quest) && (
                <Button block variant="tinted" className="mt-3" onClick={() => void act(startRoutine(r.id))}>
                  Start routine now
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}
