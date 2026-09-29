import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Collapsible } from '@/components/ui/Collapsible';
import { Button, Card, Chip, EmptyState, cx } from '@/components/ui/primitives';
import { rampLimits } from '@/domain/capacity';
import { DIFFICULTY_STATE_INFO } from '@/domain/adaptive';
import { coachLine } from '@/domain/coach';
import { computeMomentum, momentumLabel } from '@/domain/momentum';
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
import { metricToTab, type QuickTab, QuickLogSheet } from './QuickLogSheet';
import { RoutineCard } from './RoutineCard';
import { SuggestionCards } from './SuggestionCards';
import { Timeline } from './Timeline';
import { RightNowCard, useRightNow } from './RightNowCard';
import { DayJourney } from './DayJourney';
import { NextUnlockCard, OneMoreThingCard, ProgressStrip, WorldPreview } from './HomeModules';
import { WorkNudge } from './WorkNudge';
import { NutritionGlance, StatsGlance } from './TodayExtras';
import { DailyOpeningCard } from './context/DailyOpeningCard';
import { PostWorkSheet, useEndWork, WorkModeView, WorkStartCard } from './context/Work';


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
  const [showAll, setShowAll] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const context = useGame((s) => s.context);
  const endFlow = useEndWork();

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
  const rightNow = useRightNow(groups.first.find((q) => q.status === 'pending'));
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
  // Momentum is a feel-good signal only: it appears while you're on a roll and quietly fades.
  const momentum = computeMomentum(today.quests.filter((q) => q.status === 'completed' && q.completedAt).map((q) => q.completedAt!), now);
  const momentumText = momentumLabel(momentum);

  const opening = !!context?.opening;
  const featuredId = opening ? undefined : rightNow?.quest.id;
  const topToday = [...groups.core, ...groups.important, ...groups.special].filter((q) => q.id !== featuredId && q.id !== firstPending?.id).slice(0, 3);
  const pendingCount = [...groups.core, ...groups.important, ...groups.special, ...groups.side, ...groups.routines.flatMap((g) => g.quests.filter((q) => q.status === 'pending'))].length;

  const fullBoard = (
    <>
      <div className="mt-2 flex items-center justify-end">
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
          {groups.done.length > 0 && (
            <Collapsible id="done" title="Done" meta={groups.done.filter((q) => q.status === 'completed').length} defaultOpen={false}>
              {renderList(groups.done)}
            </Collapsible>
          )}
        </>
      )}
    </>
  );

  return (
    <Screen hud>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] leading-tight font-extrabold tracking-tight">
            {ramp?.label ? `Day ${dayIndex + 1}` : formatDate(date, 'EEEE')}
            <span className="ml-2 text-[14px] font-semibold text-muted">{formatDate(date, 'd MMM')}</span>
          </h1>
          <p className="truncate text-[13px] text-muted">{ramp ? (dayIndex === 0 ? `Start small: ${core.total} core objectives.` : `${core.total} core objectives today.`) : line}</p>
        </div>
        <button type="button" onClick={() => setDayOpen(true)} className="flex min-h-11 shrink-0 items-center" aria-label={`Today setup: ${dayLabel.text}, load ${today.log?.workload ?? 0} ${state.label}`}>
          <Chip icon={dayLabel.icon}>
            {dayLabel.text}
            {today.log?.sick ? ' · 🤒' : ''}
          </Chip>
        </button>
      </div>
      <DayJourney />

      {context?.openWork && !showAll ? (
        <>
          <WorkModeView onEnd={() => void endFlow.end()} onShowAll={() => setShowAll(true)} />
          <PostWorkSheet open={endFlow.post.open} minutes={endFlow.post.minutes} onClose={endFlow.close} />
        </>
      ) : (
        <>
          {context?.openWork && (
            <Card className="mt-3 !py-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[14px] font-semibold">💼 Working — quests are on hold.</span>
                <Button size="sm" variant="secondary" onClick={() => setShowAll(false)}>
                  Work Mode
                </Button>
                <Button size="sm" onClick={() => void endFlow.end()}>
                  END WORK
                </Button>
              </div>
            </Card>
          )}
          <DailyOpeningCard />
          {player.recoveryMode && (
            <div className="mt-3 rounded-2xl bg-hp/10 px-4 py-3 text-[13px] text-hp">
              <span className="font-bold">🩹 Recovery Mode</span> · essentials only, HP heals faster. Back to normal at {settings.rules.hp.recoveryExit} HP.
            </div>
          )}
          <WorkNudge date={date} workStatus={workStatus} dayIndex={dayIndex} onSetup={() => setDayOpen(true)} />
          {/* NOW — one thing at a time: the day opening first, then the work start, then the next quest. */}
          {!opening && <WorkStartCard />}
          {!opening && <RightNowCard pick={rightNow} override={firstPending} onStart={start} onOpen={setSheet} />}
          <ProgressStrip />
          {!opening && <OneMoreThingCard onStart={start} />}
          {firstDone && !firstPending && player.lifetime.coinsSpent === 0 && (
            <Card className="mt-3" onClick={() => navigate('/world')}>
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

          {/* TODAY */}
          <div className="mt-6 flex items-center justify-between gap-2 px-1">
            <h2 className="text-[12px] font-extrabold tracking-[0.14em] text-muted uppercase">Today</h2>
            {momentumText && (
              <span className="truncate rounded-full bg-accent/12 px-2.5 py-1 text-[12px] font-bold text-accent" title={`Finish another quest within ${momentum.minutesLeft} min to keep it going`} aria-label={`${momentumText}. ${momentum.minutesLeft} minutes to keep the combo going.`}>
                🔥 {momentumText}
              </span>
            )}
          </div>
          {today.quests.length === 0 ? (
            <EmptyState icon="🌱" title="No quests yet" body="Your board is being prepared. Pull in something from the library meanwhile." action={<Button onClick={() => navigate('/quests')}>Open quests</Button>} />
          ) : (
            <div className="mt-2 rounded-[24px] bg-surface px-3 py-1 shadow-card">
              {topToday.length ? (
                <div className="divide-y divide-line">
                  {topToday.map((q) => (
                    <QuestCard key={q.id} variant="row" quest={q} petName={pet} streak={q.activityId ? streaks?.[q.activityId] : undefined} now={now} onPress={() => start(q)} onOpen={() => setSheet(q)} />
                  ))}
                </div>
              ) : (
                <p className="py-3 text-[14px] text-muted">{core.total && core.done === core.total ? 'Core done ✓ Everything else is a bonus.' : 'Nothing else pressing.'}</p>
              )}
              <button type="button" onClick={() => setBoardOpen((v) => !v)} aria-expanded={boardOpen} className="flex min-h-11 w-full items-center justify-between border-t border-line text-[14px] font-semibold text-accent">
                <span>{boardOpen ? 'Hide full board' : `Full board · ${pendingCount} to do`}</span>
                <Icon name="chevronRight" size={16} className={cx('transition-transform', boardOpen && 'rotate-90')} />
              </button>
            </div>
          )}
          {boardOpen && fullBoard}

          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Quick log">
            {(
              [
                ['water', '💧', 'Water'],
                ['food', '🍽️', 'Food'],
                ['steps', '👟', 'Steps'],
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

          {/* PROGRESS & WORLD */}
          <HomeSection>Progress</HomeSection>
          <NextUnlockCard />
          <WorldPreview />

          {/* OPTIONAL — collapsed */}
          {((view === 'list' && groups.side.length > 0) || settings.leisure.enabled) && (
            <Collapsible id="optional" title="Optional" meta={groups.side.length || undefined} defaultOpen={false} className="!mt-6">
              {groups.side.length > 0 && renderList(groups.side)}
              <SuggestionCards />
              <PlayTimeCard />
            </Collapsible>
          )}

          {/* DETAILS */}
          <Collapsible id="details" title="More" defaultOpen={false} className="!mt-3">
            <NutritionGlance />
            <StatsGlance />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Card onClick={() => navigate('/review/day')} className={evening ? 'border-2 border-accent/40' : ''}>
                <div className="text-[24px]">📜</div>
                <div className="mt-1 text-[15px] font-bold">Daily recap</div>
                <div className="text-[12px] text-muted">{evening ? 'Close the day' : 'How today is going'}</div>
              </Card>
              <Card onClick={() => navigate('/quests')}>
                <div className="text-[24px]">📚</div>
                <div className="mt-1 text-[15px] font-bold">Quest library</div>
                <div className="text-[12px] text-muted">Start anything for bonus XP</div>
              </Card>
            </div>
          </Collapsible>

          <QuestSheet quest={sheet ? (today.quests.find((q) => q.id === sheet.id) ?? sheet) : null} onClose={() => setSheet(null)} onMetric={openMetric} />
          <QuickLogSheet open={quick.open} tab={quick.tab} onClose={() => setQuick((q) => ({ ...q, open: false }))} />
          <DaySheet open={dayOpen} onClose={() => setDayOpen(false)} />
          <PostWorkSheet open={endFlow.post.open} minutes={endFlow.post.minutes} onClose={endFlow.close} />
        </>
      )}
    </Screen>
  );
}

/** Home hierarchy label: RIGHT NOW → TODAY → OPTIONAL → PROGRESS. */
function HomeSection({ children }: { children: string }) {
  return <h2 className="mt-6 px-1 text-[12px] font-extrabold tracking-[0.14em] text-muted uppercase">{children}</h2>;
}
