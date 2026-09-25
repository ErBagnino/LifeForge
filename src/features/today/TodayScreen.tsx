import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Collapsible } from '@/components/ui/Collapsible';
import { Button, Card, Chip, EmptyState } from '@/components/ui/primitives';
import { rampLimits } from '@/domain/capacity';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { coachLine } from '@/domain/coach';
import { tierCount } from '@/domain/score';
import { useAsync, useNow } from '@/hooks';
import { questRepository, routineRepository } from '@/repositories';
import { activityStreak } from '@/domain/streak';
import { clock } from '@/services/clock';
import { useGame } from '@/store/gameStore';
import type { Quest, Routine } from '@/types';
import { formatDate, shiftDate } from '@/utils/date';
import { PlayTimeCard } from '../play/PlayTimeCard';
import { QuestCard } from '../quests/QuestCard';
import { QuestSheet } from '../quests/QuestSheet';
import { useQuestActions } from '../quests/useQuestActions';
import { DaySheet } from './DaySheet';
import { NextActionCard } from './NextActionCard';
import { metricToTab, type QuickTab, QuickLogSheet } from './QuickLogSheet';
import { RoutineCard } from './RoutineCard';
import { ScoreCard } from './ScoreCard';
import { SuggestionCards } from './SuggestionCards';
import { Timeline } from './Timeline';
import { WorkNudge } from './WorkNudge';
import { NutritionGlance, StatsGlance } from './TodayExtras';


function groupQuests(all: Quest[], routines: Routine[]) {
  const pending = (q: Quest) => q.status === 'pending';
  const byTime = (a: Quest, b: Quest) => (a.scheduledTime ?? '99').localeCompare(b.scheduledTime ?? '99');
  const routineGroups: { routine: Routine; quests: Quest[] }[] = [];
  const inRoutine = new Set<string>();
  for (const r of routines.filter((x) => x.active)) {
    const items = all.filter((q) => q.status !== 'moved' && q.activityId && r.activityIds.includes(q.activityId) && !inRoutine.has(q.id));
    if (items.length < 2) continue;
    items.forEach((q) => inRoutine.add(q.id));
    routineGroups.push({ routine: r, quests: items.sort(byTime) });
  }
  const visible = all.filter((q) => q.status !== 'moved' && !inRoutine.has(q.id));
  return {
    routines: routineGroups.sort((a, b) => (a.routine.startTime ?? '99').localeCompare(b.routine.startTime ?? '99')),
    first: visible.filter((q) => q.kind === 'first'),
    core: visible.filter((q) => q.tier === 'core' && pending(q) && !q.goal).sort(byTime),
    important: visible.filter((q) => q.tier === 'important' && pending(q) && !q.goal).sort(byTime),
    side: visible.filter((q) => q.tier === 'optional' && pending(q) && !q.goal && q.kind !== 'first').sort(byTime),
    special: visible.filter((q) => (q.kind === 'challenge' || q.kind === 'hidden') && pending(q)),
    done: visible.filter((q) => !pending(q) && q.kind !== 'first').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
  };
}

export default function TodayScreen() {
  const navigate = useNavigate();
  const today = useGame((s) => s.today);
  const settings = useGame((s) => s.settings);
  const player = useGame((s) => s.player);
  const actions = useQuestActions();
  const now = useNow(30000);
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [sheet, setSheet] = useState<Quest | null>(null);
  const [quick, setQuick] = useState<{ open: boolean; tab: QuickTab }>({ open: false, tab: 'water' });
  const [dayOpen, setDayOpen] = useState(false);

  const date = today?.date ?? clock.today();
  const { data: streaks } = useAsync(async () => {
    const recent = await questRepository.byRange(shiftDate(date, -60), date);
    const map: Record<string, number> = {};
    const byAct = new Map<string, Quest[]>();
    for (const q of recent) if (q.activityId) byAct.set(q.activityId, [...(byAct.get(q.activityId) ?? []), q]);
    for (const [id, list] of byAct) map[id] = activityStreak(list, date);
    return map;
  }, [date]);

  const { data: routines } = useAsync(() => routineRepository.all(), []);
  const groups = useMemo(() => groupQuests(today?.quests ?? [], routines ?? []), [today?.quests, routines]);
  if (!today || !settings || !player) return null;

  const pet = settings.profile.petName;
  const openMetric = (q: Quest) => setQuick({ open: true, tab: metricToTab(q.metric) });
  const start = (q: Quest) => actions.start(q, openMetric);
  const core = tierCount(today.quests, 'core');
  const line = coachLine({ tone: settings.tone, hour: new Date(now).getHours(), pendingCore: core.total - core.done, totalCore: core.total, energy: player.energy, seed: date, recoveryMode: player.recoveryMode });
  const state = DIFFICULTY_STATE_INFO[today.log?.difficultyState ?? 'balanced'];
  const evening = new Date(now).getHours() >= 20 || new Date(now).getHours() < 4;
  const firstPending = groups.first.find((q) => q.status === 'pending');
  const firstDone = groups.first.find((q) => q.status === 'completed');

  const renderList = (list: Quest[]) => (
    <div className="space-y-2">
      {list.map((q) => (
        <QuestCard key={q.id} quest={q} petName={pet} streak={q.activityId ? streaks?.[q.activityId] : undefined} now={now} onPress={() => start(q)} onOpen={() => setSheet(q)} />
      ))}
    </div>
  );

  const dayIndex = today.log?.dayIndex ?? 99;
  const ramp = rampLimits(dayIndex);
  const workStatus = today.plan.workStatus ?? (today.plan.work ? 'set' : 'off');
  const dayLabel =
    today.plan.dayType === 'rest'
      ? { icon: '🛌', text: 'Rest day' }
      : workStatus === 'unknown'
        ? { icon: '📅', text: 'Hours not set' }
        : workStatus === 'off'
          ? { icon: '🌤️', text: 'Free day' }
          : { icon: '💼', text: workStatus === 'partial' ? 'Workday · partial' : 'Workday' };
  const sideOpen = groups.side.length <= 3;

  return (
    <Screen hud>
      <div className="mt-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-muted">{formatDate(date, 'EEEE d MMMM')}</div>
          <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">{ramp?.label ? `Day ${dayIndex + 1}` : 'Today'}</h1>
        </div>
        <button type="button" onClick={() => setDayOpen(true)} className="flex min-h-11 shrink-0 flex-col items-end justify-center gap-1" aria-label="Today setup">
          <Chip icon={dayLabel.icon}>
            {dayLabel.text}
            {today.log?.sick ? ' · 🤒' : ''}
          </Chip>
          <Chip icon={state.icon}>
            Load {today.log?.workload ?? 0} · {state.label}
          </Chip>
        </button>
      </div>
      <p className="mt-1 text-[15px] text-muted">{line}</p>
      {player.recoveryMode && (
        <div className="mt-3 rounded-3xl bg-hp/10 p-4 text-[14px] text-hp">
          <span className="font-bold">🩹 Recovery Mode.</span> Essentials only, penalties softened, HP heals faster. Get HP back to {settings.rules.hp.recoveryExit} to exit.
        </div>
      )}

      {ramp && (
        <Card className="mt-4 bg-gradient-to-br from-accent/12 to-xp/10">
          <div className="text-[12px] font-extrabold tracking-widest text-accent">{ramp.label?.toUpperCase() ?? `DAY ${dayIndex + 1}`}</div>
          <div className="mt-1 text-[17px] font-bold">
            {dayIndex === 0 ? `Start small: ${core.total} core objectives.` : `${core.total} core objectives today.`}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {dayIndex === 0 ? 'That’s the whole day. Routines, side quests and bigger goals unlock as you play.' : 'The board grows a little each day while the game learns your rhythm.'}
          </p>
        </Card>
      )}

      <WorkNudge date={date} workStatus={workStatus} dayIndex={dayIndex} onSetup={() => setDayOpen(true)} />

      {firstPending && (
        <Card className="mt-4 border-2 border-accent/40">
          <div className="text-[12px] font-extrabold tracking-widest text-accent">FIRST QUEST</div>
          <div className="mt-1 text-[18px] font-bold">Your real life is the game.</div>
          <p className="mt-1 text-[14px] text-muted">Do this for real, then tap the circle. That’s the whole loop: real action → XP → coins → a better world.</p>
          <div className="mt-3">{renderList([firstPending])}</div>
        </Card>
      )}
      {firstDone && !firstPending && player.lifetime.coinsSpent === 0 && (
        <Card className="mt-4" onClick={() => navigate('/world')}>
          <div className="flex items-center gap-3">
            <span className="text-[34px]">🏗️</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-extrabold tracking-widest text-success">FIRST UPGRADE UNLOCKED</div>
              <div className="text-[15px] font-semibold">You have {player.coins} coins. Buy the Cozy Lamp for your room.</div>
            </div>
            <Icon name="chevronRight" className="shrink-0 text-faint" />
          </div>
        </Card>
      )}

      <ScoreCard />
      <NextActionCard onStart={start} onOpen={setSheet} />
      <SuggestionCards />

      <div className="mt-5 flex items-center justify-between gap-2">
        <h2 className="text-[20px] font-bold">Quests</h2>
        <Segmented
          size="sm"
          className="w-[184px] shrink-0"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: <><Icon name="list" size={15} /> List</> },
            { value: 'timeline', label: <><Icon name="timeline" size={15} /> Timeline</> },
          ]}
        />
      </div>

      {view === 'timeline' ? (
        <div className="mt-3">
          <Timeline quests={today.quests} plan={today.plan} now={now} dayStartHour={settings.dayStartHour} petName={pet} onOpen={setSheet} />
        </div>
      ) : (
        <>
          {today.quests.length === 0 && <EmptyState icon="🌱" title="No quests yet" body="Your board is being prepared. Pull in something from the library meanwhile." action={<Button onClick={() => navigate('/quests')}>Open quests</Button>} />}
          {groups.core.length > 0 && (
            <Collapsible id="core" title="Core quests" meta={`${core.done}/${core.total}`} className="!mt-3">
              {renderList(groups.core)}
            </Collapsible>
          )}
          {groups.routines.length > 0 && (
            <Collapsible id="routines" title="Routines" meta={groups.routines.length}>
              <div className="space-y-2">
                {groups.routines.map((g) => (
                  <RoutineCard key={g.routine.id} routine={g.routine} quests={g.quests} done={!!today.log?.routinesDone?.includes(g.routine.id)}>
                    {renderList(g.quests)}
                  </RoutineCard>
                ))}
              </div>
            </Collapsible>
          )}
          {groups.special.length > 0 && (
            <Collapsible id="special" title="Challenge & secrets" meta={groups.special.length}>
              {renderList(groups.special)}
            </Collapsible>
          )}
          {groups.important.length > 0 && (
            <Collapsible id="important" title="Important" meta={groups.important.length}>
              {renderList(groups.important)}
            </Collapsible>
          )}
          {groups.side.length > 0 && (
            <Collapsible id="optional" title="Optional & side quests" meta={groups.side.length} defaultOpen={sideOpen}>
              {renderList(groups.side)}
            </Collapsible>
          )}
          {groups.done.length > 0 && (
            <Collapsible id="done" title="Done" meta={groups.done.filter((q) => q.status === 'completed').length} defaultOpen={false}>
              {renderList(groups.done)}
            </Collapsible>
          )}
        </>
      )}

      <PlayTimeCard />
      <NutritionGlance />

      <Collapsible id="quick" title="Quick log" className="!mt-4">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {(
            [
              ['water', '💧', 'Water'],
              ['steps', '👟', 'Steps'],
              ['food', '🍽️', 'Food'],
              ['sleep', '😴', 'Sleep'],
              ['weight', '⚖️', 'Weight'],
              ['activity', '🏃', 'Activity'],
            ] as [QuickTab, string, string][]
          ).map(([tab, icon, label]) => (
            <button key={tab} type="button" onClick={() => setQuick({ open: true, tab })} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-semibold shadow-card active:scale-95">
              <span aria-hidden>{icon}</span> {label}
            </button>
          ))}
        </div>
      </Collapsible>

      <StatsGlance />

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Card onClick={() => navigate('/review/day')} className={evening ? 'border-2 border-accent/40' : ''}>
          <div className="text-[24px]">📜</div>
          <div className="mt-1 text-[15px] font-bold">Daily recap</div>
          <div className="text-[12px] text-muted">{evening ? 'Close the day like a pro' : 'How today is going'}</div>
        </Card>
        <Card onClick={() => navigate('/quests')}>
          <div className="text-[24px]">📚</div>
          <div className="mt-1 text-[15px] font-bold">Quest library</div>
          <div className="text-[12px] text-muted">Start anything for bonus XP</div>
        </Card>
      </div>

      <QuestSheet quest={sheet ? (today.quests.find((q) => q.id === sheet.id) ?? sheet) : null} onClose={() => setSheet(null)} onMetric={openMetric} />
      <QuickLogSheet open={quick.open} tab={quick.tab} onClose={() => setQuick((q) => ({ ...q, open: false }))} />
      <DaySheet open={dayOpen} onClose={() => setDayOpen(false)} />
    </Screen>
  );
}
