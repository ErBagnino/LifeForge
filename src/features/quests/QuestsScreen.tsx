import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Field, Segmented, Select, TextInput, NumberInput } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, Chip, EmptyState, SectionTitle, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { CATEGORY_INFO, RARITY_INFO } from '@/data/categories';
import { describeGoal } from '@/domain/goals';
import { FEATURE_LEVELS } from '@/domain/level';
import { describeRecurrence } from '@/domain/recurrence';
import { useAsync, useLevel, useNow } from '@/hooks';
import { activityRepository } from '@/repositories';
import { addManualQuest, startActivityNow } from '@/services/game/questService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { ActivityCategory, Difficulty, Quest } from '@/types';
import { CATEGORIES } from '@/types';
import { daysBetween } from '@/utils/date';
import { QuickLogSheet, metricToTab, type QuickTab } from '../today/QuickLogSheet';
import { QuestCard } from './QuestCard';
import { QuestSheet } from './QuestSheet';
import { useQuestActions } from './useQuestActions';

type Tab = 'today' | 'long' | 'library';

export default function QuestsScreen() {
  const [tab, setTab] = useState<Tab>('today');
  const navigate = useNavigate();
  return (
    <Screen hud>
      <div className="mt-4 flex items-end justify-between">
        <h1 className="text-[30px] leading-tight font-extrabold tracking-tight">Quests</h1>
        <Button size="sm" variant="secondary" onClick={() => navigate('/quests/routines')}>
          🌅 Routines
        </Button>
      </div>
      <Segmented
        className="mt-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'long', label: 'Weekly' },
          { value: 'library', label: 'Library' },
        ]}
      />
      {tab === 'today' && <TodayTab />}
      {tab === 'long' && <LongTab />}
      {tab === 'library' && <LibraryTab />}
    </Screen>
  );
}

function TodayTab() {
  const today = useGame((s) => s.today);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const act = useGame((s) => s.act);
  const { level } = useLevel();
  const actions = useQuestActions();
  const now = useNow();
  const [sheet, setSheet] = useState<Quest | null>(null);
  const [quick, setQuick] = useState<{ open: boolean; tab: QuickTab }>({ open: false, tab: 'water' });
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState({ title: '', icon: '✨', category: 'general' as ActivityCategory, difficulty: 2 as Difficulty, durationMin: 15 });
  if (!today) return null;
  const openMetric = (q: Quest) => setQuick({ open: true, tab: metricToTab(q.metric) });
  const list = (qs: Quest[]) => (
    <div className="space-y-2">
      {qs.map((q) => (
        <QuestCard key={q.id} quest={q} petName={pet} now={now} onPress={() => actions.start(q, openMetric)} onOpen={() => setSheet(q)} />
      ))}
    </div>
  );
  const challenge = today.quests.filter((q) => q.kind === 'challenge');
  const hidden = today.quests.filter((q) => q.kind === 'hidden');
  const side = today.quests.filter((q) => q.kind === 'side' || q.kind === 'manual');
  const scheduled = today.quests.filter((q) => q.kind === 'scheduled' || q.kind === 'workout' || q.kind === 'first');

  return (
    <>
      <SectionTitle>Daily challenge</SectionTitle>
      {challenge.length ? list(challenge) : <Locked label="Daily Challenge" level={FEATURE_LEVELS.challenge} current={level} fallback="No challenge today — the game decided you have enough on your plate." />}
      <SectionTitle>Hidden quest</SectionTitle>
      {hidden.length ? list(hidden) : <Locked label="Hidden quests" level={FEATURE_LEVELS.hidden} current={level} fallback="No secret today. Or is there…" />}
      <SectionTitle action={<button type="button" className="text-[14px] font-semibold text-accent" onClick={() => setManual(true)}>+ Custom</button>}>Side quests</SectionTitle>
      {side.length ? list(side) : <Locked label="Side quests" level={FEATURE_LEVELS.sideQuests} current={level} fallback="No side quests today: workload or energy says protect the core." />}
      <SectionTitle>Scheduled</SectionTitle>
      {list(scheduled)}

      <QuestSheet quest={sheet ? (today.quests.find((q) => q.id === sheet.id) ?? sheet) : null} onClose={() => setSheet(null)} onMetric={openMetric} />
      <QuickLogSheet open={quick.open} tab={quick.tab} onClose={() => setQuick((q) => ({ ...q, open: false }))} />
      <Sheet open={manual} onClose={() => setManual(false)} title="Custom quest">
        <div className="space-y-3">
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <Field label="Icon">
              <TextInput value={draft.icon} onChange={(v) => setDraft({ ...draft, icon: v.slice(0, 4) })} aria-label="Icon" />
            </Field>
            <Field label="What will you do?">
              <TextInput value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Fix the bike" aria-label="Quest title" autoFocus />
            </Field>
          </div>
          <Field label="Category">
            <Select value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: `${CATEGORY_INFO[c].icon} ${CATEGORY_INFO[c].label}` }))} aria-label="Category" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Difficulty (1–5)">
              <NumberInput value={draft.difficulty} onChange={(v) => setDraft({ ...draft, difficulty: Math.min(5, Math.max(1, Math.round(v))) as Difficulty })} aria-label="Difficulty" />
            </Field>
            <Field label="Minutes">
              <NumberInput value={draft.durationMin} onChange={(v) => setDraft({ ...draft, durationMin: Math.max(1, Math.round(v)) })} aria-label="Duration" />
            </Field>
          </div>
          <Button
            block
            size="lg"
            disabled={!draft.title.trim()}
            onClick={async () => {
              await act(addManualQuest({ ...draft, tier: 'optional' }));
              setManual(false);
              setDraft({ ...draft, title: '' });
            }}
          >
            Add to today
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function Locked({ label, level, current, fallback }: { label: string; level: number; current: number; fallback: string }) {
  if (current >= level) return <div className="rounded-3xl bg-surface-2 px-4 py-3 text-[13px] text-muted">{fallback}</div>;
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-surface-2 px-4 py-3 text-[13px] text-muted">
      <Icon name="lock" size={16} /> {label} unlock at level {level}.
    </div>
  );
}

function LongTab() {
  const long = useGame((s) => s.today?.long ?? []);
  const date = useGame((s) => s.today?.date ?? '');
  const { level } = useLevel();
  const weekly = long.filter((q) => q.kind === 'weekly');
  const boss = long.filter((q) => q.kind === 'boss');
  const card = (q: Quest) => {
    const done = q.status === 'completed';
    const left = q.endDate ? daysBetween(date, q.endDate) : 0;
    return (
      <Card key={q.id} className={cx(done && 'opacity-70')}>
        <div className="flex items-start gap-3">
          <span className="text-[34px]">{q.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[16px] font-bold">{q.title}</span>
              <Chip color={RARITY_INFO[q.rarity].color}>{RARITY_INFO[q.rarity].label}</Chip>
            </div>
            <div className="text-[13px] text-muted">{q.goal ? describeGoal(q.goal) : q.description}</div>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={(q.progress ?? 0) / Math.max(1, q.target ?? 1)} color={done ? 'var(--lf-success)' : q.kind === 'boss' ? 'var(--lf-hp)' : 'var(--lf-accent)'} height={8} />
              <span className="num shrink-0 text-[12px] font-bold">
                {(q.progress ?? 0).toLocaleString('en-US')}/{(q.target ?? 0).toLocaleString('en-US')}
              </span>
            </div>
            <div className="num mt-1.5 flex justify-between text-[12px]">
              <span className="font-bold text-xp">
                +{q.xp} XP · <span className="text-coin">+{q.coins} 🪙</span>
              </span>
              <span className="text-muted">{done ? '✓ Complete' : `${left} day${left === 1 ? '' : 's'} left`}</span>
            </div>
          </div>
        </div>
      </Card>
    );
  };
  return (
    <>
      <SectionTitle>This week’s chapter</SectionTitle>
      {weekly.length ? <div className="space-y-2">{weekly.map(card)}</div> : <EmptyState icon="📘" title={level < FEATURE_LEVELS.weekly ? `Weekly quests unlock at level ${FEATURE_LEVELS.weekly}` : 'No weekly quests'} body="Each week is a chapter with 3 multi-day goals." />}
      <SectionTitle>Boss of the month</SectionTitle>
      {boss.length ? <div className="space-y-2">{boss.map(card)}</div> : <EmptyState icon="🐉" title={level < FEATURE_LEVELS.boss ? `Boss quests unlock at level ${FEATURE_LEVELS.boss}` : 'No boss this month'} body="A big monthly goal with a big reward." />}
    </>
  );
}

function LibraryTab() {
  const act = useGame((s) => s.act);
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const today = useGame((s) => s.today);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<ActivityCategory | 'all'>('all');
  const { data } = useAsync(() => activityRepository.active(), []);
  const onBoard = new Set(today?.quests.filter((q) => q.status !== 'moved').map((q) => q.activityId));
  const list = useMemo(
    () =>
      (data ?? [])
        .filter((a) => (cat === 'all' || a.category === cat) && resolveText(a.name, pet).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, cat, query, pet],
  );
  return (
    <div className="mt-3">
      <TextInput value={query} onChange={setQuery} placeholder="Search activities…" aria-label="Search activities" type="search" />
      <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {(['all', ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={cx('h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold', cat === c ? 'bg-accent text-on-accent' : 'bg-surface shadow-card')}>
            {c === 'all' ? 'All' : `${CATEGORY_INFO[c].icon} ${CATEGORY_INFO[c].label}`}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {list.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-3xl bg-surface p-3 shadow-card">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-[22px]">{a.icon}</span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(`/admin/activities/${a.id}`)}>
              <div className="truncate text-[15px] font-semibold">{resolveText(a.name, pet)}</div>
              <div className="truncate text-[12px] text-muted">
                {CATEGORY_INFO[a.category].label} · {describeRecurrence(a)} · {a.durationMin} min
              </div>
            </button>
            <Button size="sm" variant={onBoard.has(a.id) ? 'secondary' : 'tinted'} disabled={onBoard.has(a.id)} onClick={() => void act(startActivityNow(a.id))}>
              {onBoard.has(a.id) ? 'On board' : 'Start'}
            </Button>
          </div>
        ))}
        {!list.length && <EmptyState icon="🔍" title="Nothing found" body="Create a new activity in Admin, or with AI." action={<Button onClick={() => navigate('/admin/activities/new')}>New activity</Button>} />}
      </div>
    </div>
  );
}
