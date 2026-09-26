import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Button, Card } from '@/components/ui/primitives';
import { formatDuration, STATE_INFO } from '@/domain/dailyContext';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { Quest } from '@/types';
import { useQuestActions } from '../../quests/useQuestActions';
import { PriorityChip } from './Work';

/**
 * "What matters now": the few quests that fit the time left, in context-aware
 * priority order, with a lighter option when energy is low. The full lists stay
 * below for everything else.
 */
export function FocusCard({ onStart, onOpen }: { onStart: (q: Quest) => void; onOpen: (q: Quest) => void }) {
  const context = useGame((s) => s.context);
  const settings = useGame((s) => s.settings);
  const today = useGame((s) => s.today);
  const actions = useQuestActions();
  const navigate = useNavigate();
  if (!context || !settings || !today || context.openWork) return null;
  const { view } = context;
  const info = STATE_INFO[view.state];
  const pet = settings.profile.petName;
  const notToday = view.decisions.filter((d) => !d.realistic && d.priority !== 'OPTIONAL').length;

  if (view.state === 'SLEEP' || view.state === 'WIND_DOWN') {
    const done = today.quests.filter((q) => q.status === 'completed').length;
    return (
      <Card className="mt-3">
        <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">{info.icon} {info.label.toUpperCase()}</div>
        <p className="mt-1 text-[15px]">
          {done} quests done today · score {today.log?.score ?? 0}.{view.state === 'WIND_DOWN' && view.focus.length ? ' A few light things left:' : ''}
        </p>
        {view.state === 'WIND_DOWN' && view.focus.length > 0 && <FocusList focus={view.focus} pet={pet} onOpen={onOpen} />}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => navigate('/review/day')}>
            Daily summary
          </Button>
          <Button variant="secondary" onClick={() => navigate('/review/day#tomorrow')}>
            Tomorrow
          </Button>
        </div>
      </Card>
    );
  }
  if (!view.focus.length) return null;
  const [first, ...rest] = view.focus;
  const title = `${info.icon} ${info.label}`;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[12px] font-extrabold tracking-[0.16em] text-accent">RIGHT NOW · {title.toUpperCase()}</div>
          <span className="num shrink-0 text-[12px] text-muted">{formatDuration(view.availableMin)} left</span>
        </div>
        <button type="button" onClick={() => onOpen(first.quest)} className="mt-2 flex min-h-11 w-full items-center gap-3 text-left">
          <span className="text-[30px]" aria-hidden>
            {first.quest.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] leading-snug font-bold break-words">{resolveText(first.quest.title, pet)}</span>
            <span className="block text-[13px] text-muted">{first.reason}</span>
          </span>
          <PriorityChip p={first.priority} />
        </button>
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" icon="play" onClick={() => onStart(first.quest)}>
            {first.quest.kind === 'workout' ? 'Start workout' : 'Do it'}
          </Button>
          {first.alternative && (
            <Button variant="secondary" className="flex-1" onClick={() => void actions.shorten(first.quest, first.alternative!.durationMin)}>
              {first.alternative.label}
            </Button>
          )}
        </div>
        {rest.length > 0 && <FocusList focus={rest} pet={pet} onOpen={onOpen} />}
        <p className="mt-2 text-[12px] text-muted">
          {view.fits ? `All of this fits in the ${formatDuration(view.availableMin)} left (about ${formatDuration(view.plannedMin)} of work).` : `More than the time left — ordered by what matters most.`}
          {notToday > 0 ? ` ${notToday} won’t realistically fit today; they stay in the lists below.` : ''}
        </p>
      </Card>
    </motion.div>
  );
}

function FocusList({ focus, pet, onOpen }: { focus: NonNullable<ReturnType<typeof useGame.getState>['context']>['view']['focus']; pet: string; onOpen: (q: Quest) => void }) {
  return (
    <ul className="mt-2 divide-y divide-line">
      {focus.map((d) => (
        <li key={d.quest.id}>
          <button type="button" onClick={() => onOpen(d.quest)} className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left">
            <span className="text-[18px]" aria-hidden>
              {d.quest.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{resolveText(d.quest.title, pet)}</span>
            {d.quest.durationMin >= 5 && !d.quest.metric && <span className="num shrink-0 text-[12px] text-muted">{d.quest.durationMin}′</span>}
            <PriorityChip p={d.priority} />
          </button>
        </li>
      ))}
    </ul>
  );
}
