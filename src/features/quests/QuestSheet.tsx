import { useMemo, useState } from 'react';
import { CategoryChip, RarityChip, TierChip } from '@/components/game/bits';
import { Field, TimeInput } from '@/components/ui/forms';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { describeGoal } from '@/domain/goals';
import { applyMultipliers, DIFFICULTY_LABELS, rewardMultipliers } from '@/domain/rewards';
import { postponeWarning, snoozeOptions } from '@/domain/snooze';
import { worldBonuses } from '@/domain/tycoon';
import { useAsync, useNow } from '@/hooks';
import { activityRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { Quest, SkipReason } from '@/types';
import { minuteOfDay, tsToHm } from '@/utils/date';
import { questProgressLabel } from './QuestCard';
import { useQuestActions } from './useQuestActions';

const SKIP_REASONS: { value: SkipReason; label: string; icon: string }[] = [
  { value: 'no_time', label: 'No time', icon: '⏳' },
  { value: 'tired', label: 'Too tired', icon: '🥱' },
  { value: 'not_needed', label: 'I don’t want to do it today', icon: '🤷' },
  { value: 'sick', label: 'Sick (no penalty)', icon: '🤒' },
  { value: 'other', label: 'Other', icon: '💬' },
];

type Mode = 'main' | 'snooze' | 'skip' | 'time' | 'done';

export function QuestSheet({ quest, onClose, onMetric }: { quest: Quest | null; onClose: () => void; onMetric: (q: Quest) => void }) {
  return (
    <Sheet open={!!quest} onClose={onClose} title={quest ? (quest.hidden && quest.status !== 'completed' ? '??? Hidden quest' : undefined) : undefined}>
      {quest && <QuestSheetBody key={quest.id} quest={quest} onClose={onClose} onMetric={onMetric} />}
    </Sheet>
  );
}

function QuestSheetBody({ quest: q, onClose, onMetric }: { quest: Quest; onClose: () => void; onMetric: (q: Quest) => void }) {
  const actions = useQuestActions();
  const settings = useGame((s) => s.settings)!;
  const player = useGame((s) => s.player)!;
  const buildings = useGame((s) => s.buildings);
  const plan = useGame((s) => s.today?.plan);
  const now = useNow(15000);
  const [mode, setMode] = useState<Mode>('main');
  const [time, setTime] = useState(q.scheduledTime ?? tsToHm(now));
  const [doneAt, setDoneAt] = useState(tsToHm(now));
  const pet = settings.profile.petName;
  const done = q.status === 'completed';
  const pending = q.status === 'pending';
  const hiddenUnrevealed = q.hidden && !done;

  const preview = useMemo(() => {
    const b = worldBonuses(buildings);
    const m = rewardMultipliers(
      {
        now,
        date: clock.today(),
        streak: player.streak.current,
        preset: settings.rules.difficultyPresets[settings.difficulty],
        boosts: player.boosts,
        effects: player.effects,
        categoryXpPct: b.xpPctByCategory[q.category] ?? 0,
        categoryCoinPct: b.coinPctByCategory[q.category] ?? 0,
        recoveryMode: player.recoveryMode,
      },
      settings.rules.xp,
    );
    return { multipliers: m, ...applyMultipliers({ xp: q.xp, coins: q.coins }, m) };
  }, [buildings, now, player, settings, q]);

  const { data: activity } = useAsync(() => (q.activityId ? activityRepository.get(q.activityId) : Promise.resolve(undefined)), [q.activityId], { live: false });
  const isDaily = activity?.recurrence.type === 'daily';
  const options = plan ? snoozeOptions(now, minuteOfDay(now), clock.today(), plan, activity?.recurrence, settings.dayStartHour) : [];
  const warning = postponeWarning(q, q.rescheduleCount, settings.rules.penalties.snoozeWarnAt);
  const close = (p?: Promise<unknown>) => {
    void p;
    onClose();
  };

  return (
    <div className="pt-1">
      {!hiddenUnrevealed && (
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface text-[30px] shadow-card">{q.icon}</div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[20px] leading-tight font-bold">{resolveText(q.title, pet)}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <TierChip tier={q.tier} kind={q.kind} />
              <CategoryChip category={q.category} />
              <RarityChip rarity={q.rarity} />
              <Chip>{DIFFICULTY_LABELS[q.difficulty]}</Chip>
            </div>
          </div>
        </div>
      )}
      {hiddenUnrevealed && (
        <Card className="text-center">
          <div className="text-5xl">❔</div>
          <p className="mt-2 text-[15px] text-muted">Hidden quests complete themselves when you meet a secret condition.</p>
          {q.hint && <p className="mt-2 text-[16px] font-semibold italic">“{q.hint}”</p>}
        </Card>
      )}

      {q.description && !hiddenUnrevealed && <p className="mt-3 text-[15px] leading-relaxed text-fg/85">{resolveText(q.description, pet)}</p>}
      {q.goal && !hiddenUnrevealed && (
        <Card className="mt-3">
          <div className="text-[13px] font-semibold text-muted">Goal</div>
          <div className="mt-0.5 text-[15px] font-semibold">{describeGoal(q.goal)}</div>
          {q.target !== undefined && (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={q.progress / Math.max(1, q.target)} />
              <span className="num text-[12px] font-bold text-muted">
                {q.progress}/{q.target}
              </span>
            </div>
          )}
          {q.endDate && <div className="mt-1 text-[12px] text-muted">Ends {q.endDate}</div>}
        </Card>
      )}
      {q.target !== undefined && !q.goal && (
        <Card className="mt-3">
          <div className="flex items-center justify-between text-[14px]">
            <span className="font-semibold">{q.metricMode === 'atMost' ? 'Used today' : 'Progress'}</span>
            <span className="num font-bold">{questProgressLabel(q)}</span>
          </div>
          <ProgressBar value={q.progress / Math.max(1, q.target)} className="mt-2" color={q.metricMode === 'atMost' && q.progress > q.target ? 'var(--lf-danger)' : undefined} />
          {q.metricMode === 'atMost' && <p className="mt-2 text-[12px] text-muted">Budget quest: it is won automatically at the end of the day if you stay under the limit.</p>}
        </Card>
      )}
      {q.lightened && pending ? (
        <div className="mt-3 rounded-2xl bg-surface-2 p-3">
          <p className="text-[13px] text-muted">
            <span className="font-semibold text-fg">Lightened today: </span>
            {q.reason ?? 'Your day is already full, so this became a no-pressure bonus.'}
          </p>
          <Button block variant="tinted" icon="check" className="mt-2" onClick={() => close(actions.keep(q))}>
            Keep this task
          </Button>
        </div>
      ) : (
        q.reason && (
          <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] text-muted">
            <span className="font-semibold text-fg">Why this quest: </span>
            {q.reason}
          </p>
        )
      )}
      {warning && pending && (
        <p className={`mt-3 rounded-2xl px-3 py-2 text-[13px] font-semibold ${warning.level === 'alert' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'}`}>⚠️ {warning.text}</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface p-2.5 shadow-card">
          <div className="num text-[18px] font-bold text-xp">+{done && q.earned ? q.earned.xp : preview.xp}</div>
          <div className="text-[11px] text-muted">XP</div>
        </div>
        <div className="rounded-2xl bg-surface p-2.5 shadow-card">
          <div className="num text-[18px] font-bold text-coin">+{done && q.earned ? q.earned.coins : preview.coins}</div>
          <div className="text-[11px] text-muted">Coins</div>
        </div>
        <div className="rounded-2xl bg-surface p-2.5 shadow-card">
          <div className="num text-[18px] font-bold text-energy">{q.energyCost > 0 ? `−${q.energyCost}` : q.energyCost < 0 ? `+${-q.energyCost}` : '0'}</div>
          <div className="text-[11px] text-muted">Energy</div>
        </div>
      </div>
      {preview.multipliers.length > 0 && !done && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preview.multipliers.map((m, i) => (
            <Chip key={i} color={m.value >= 1 ? '#7c5cff' : '#ff9f0a'}>
              {m.label} ×{m.value.toFixed(2)}
            </Chip>
          ))}
        </div>
      )}

      {mode === 'main' && (
        <div className="mt-5 space-y-2">
          {pending && !q.goal && !(q.metricMode === 'atMost') && (
            <Button
              block
              size="lg"
              icon={q.kind === 'workout' ? 'play' : q.metric ? 'plus' : 'check'}
              onClick={() => {
                if (q.metric || q.kind === 'workout' || q.activityId === 'cardio_session') {
                  onClose();
                  actions.start(q, onMetric);
                } else close(actions.complete(q));
              }}
            >
              {q.kind === 'workout' ? 'Start workout' : q.metric ? 'Log progress' : 'Complete quest'}
            </Button>
          )}
          {q.metricMode === 'atMost' && pending && (
            <Button block size="lg" icon="play" onClick={() => { onClose(); actions.start(q, onMetric); }}>
              Open play-time timer
            </Button>
          )}
          {pending && !q.goal && !q.metric && q.kind !== 'workout' && (
            <Button block variant="secondary" icon="clock" onClick={() => setMode('done')}>
              Completed earlier… (set time)
            </Button>
          )}
          {pending && !q.goal && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" icon="clock" onClick={() => setMode('snooze')}>
                Snooze
              </Button>
              <Button variant="secondary" icon="calendar" onClick={() => setMode('time')}>
                Reschedule
              </Button>
              <Button variant="secondary" icon="close" onClick={() => setMode('skip')}>
                Skip
              </Button>
              {q.kind === 'side' ? (
                <Button variant="secondary" icon="dice" onClick={() => close(actions.reroll(q))}>
                  Reroll {player.inventory.reroll > 0 ? `(${player.inventory.reroll})` : `(${settings.rules.generator.rerollCost}🪙)`}
                </Button>
              ) : !isDaily ? (
                <Button variant="secondary" icon="chevronRight" onClick={() => close(actions.tomorrow(q))}>
                  Tomorrow
                </Button>
              ) : null}
            </div>
          )}
          {pending && (q.kind === 'manual' || q.kind === 'side') && (
            <Button block variant="danger" icon="trash" onClick={() => close(actions.remove(q))}>
              Remove from today
            </Button>
          )}
          {done && !q.goal && (
            <>
              <Button block variant="secondary" icon="clock" onClick={() => setMode('time')}>
                Correct completion time ({q.actualTime})
              </Button>
              <Button block variant="danger" icon="undo" onClick={() => close(actions.uncomplete(q))}>
                Undo completion
              </Button>
            </>
          )}
        </div>
      )}

      {mode === 'snooze' && (
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-semibold text-muted">Snooze until…</div>
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <Button
                key={o.kind}
                variant="secondary"
                size="lg"
                className="flex-col !gap-0"
                onClick={() => close(o.until ? actions.snooze(q, o.until) : actions.tomorrow(q))}
              >
                <span>{o.label}</span>
                <span className="num text-[12px] font-medium text-muted">{o.detail}</span>
              </Button>
            ))}
          </div>
          <Button block variant="ghost" className="mt-2" onClick={() => setMode('main')}>
            Back
          </Button>
        </div>
      )}

      {mode === 'skip' && (
        <div className="mt-5 space-y-2">
          <div className="text-[13px] font-semibold text-muted">Why skip? (Honest answers make the game smarter.)</div>
          {SKIP_REASONS.map((r) => (
            <Button key={r.value} block variant="secondary" onClick={() => close(actions.skip(q, r.value))}>
              {r.icon} {r.label}
            </Button>
          ))}
          <Button block variant="ghost" onClick={() => setMode('main')}>
            Back
          </Button>
        </div>
      )}

      {(mode === 'time' || mode === 'done') && (
        <div className="mt-5 space-y-3">
          <Field label={mode === 'done' ? 'When did you do it?' : done ? 'Actual completion time' : 'New time'}>
            <TimeInput value={mode === 'done' ? doneAt : time} onChange={mode === 'done' ? setDoneAt : setTime} aria-label="Time" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setMode('main')}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (mode === 'done') close(actions.complete(q, doneAt));
                else if (done) close(actions.setActual(q, time));
                else close(actions.reschedule(q, time));
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
