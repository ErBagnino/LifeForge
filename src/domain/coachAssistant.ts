import type { BodyGoal, ExceptionKind, ISODate, LoadMode, ResolvedWork, Settings, TimeHM, WorkDayEntry } from '@/types';
import { dateRange, formatDate, shiftDate, weekday, weekStart } from '@/utils/date';
import { goalLabel } from './profile';
import { activeSchedule, blankWeek, describeEntry, summarizeSchedule, WEEKDAY_NAMES } from './schedule';
import { type Intent, nextWeekday, parseMessage, type Scope, type TimeInfo, type WorkClause } from './nlu';

// ——— Types ———

export type ConfigChange =
  | { type: 'work_status'; status: 'unknown' }
  | { type: 'work_schedule'; days: WorkDayEntry[]; effectiveFrom: ISODate; variable?: boolean }
  | { type: 'temporary_work'; dates: ISODate[]; entry: WorkDayEntry }
  | { type: 'exception'; kind: ExceptionKind; from: ISODate; to?: ISODate; note?: string }
  | { type: 'load_mode'; mode: LoadMode }
  | { type: 'goals'; goals: string[]; focus?: string; bodyGoal?: BodyGoal }
  | { type: 'wake'; time?: TimeHM }
  | { type: 'sleep'; time?: TimeHM }
  | { type: 'weight'; kg: number }
  | { type: 'height'; cm: number }
  | { type: 'steps'; ideal?: number }
  | { type: 'training'; days: number[] | 'unknown' }
  | { type: 'keep_quest'; questId: string; title: string };

export interface Proposal {
  id: string;
  title: string;
  lines: string[];
  changes: ConfigChange[];
  note?: string;
  /** Days that were assumed rather than said (shown as editable chips). */
  assumedDays?: boolean;
  status: 'pending' | 'applied' | 'dismissed';
  /** Filled in by the service: effect on today's board. */
  impact?: string[];
}

export interface QuickReply {
  label: string;
  value: string;
}

interface WorkDraft {
  clauses: WorkClause[];
  offDays: number[];
  days?: number[];
  approximate: boolean;
  variable?: boolean;
}

export type Pending =
  | { kind: 'hours'; scope?: Scope; days?: number[] }
  | { kind: 'end_time'; days: number[]; from: ISODate }
  | { kind: 'scope_hours'; draft: WorkDraft }
  | { kind: 'goal_choice' }
  | { kind: 'plan_known' }
  | { kind: 'mode_scope'; mode: 'keep_all' | 'push' }
  | { kind: 'keep_choice' };

export interface CoachReply {
  text: string;
  proposal?: Proposal;
  quick?: QuickReply[];
  pending?: Pending;
  /** Extra content the service renders: today's plan or the profile summary. */
  action?: 'plan_summary' | 'status' | 'confirm_last' | 'dismiss_last';
}

export interface AssistantContext {
  today: ISODate;
  settings: Settings;
  /** Today's work as currently known. */
  todayWork: ResolvedWork;
  /** Pending quests the balancer lightened (for "keep this task"). */
  lightened: { id: string; title: string }[];
  /** Whether the chat currently shows a proposal waiting for an answer. */
  hasPendingProposal: boolean;
  newId: () => string;
}

// ——— Helpers ———

const d = (iso: ISODate) => formatDate(iso, 'EEE d MMM');
const MON_FRI = [1, 2, 3, 4, 5];

type WorkEntry = Extract<WorkDayEntry, { kind: 'work' }>;

function mergeTimes(base: WorkDayEntry | undefined, t: TimeInfo, approximate: boolean): WorkEntry {
  const prev = base?.kind === 'work' ? base : undefined;
  return {
    kind: 'work',
    start: t.start ?? (t.later ? undefined : prev?.start),
    end: t.end ?? (t.earlier ? undefined : prev?.end),
    breakMin: t.breakMin ?? prev?.breakMin,
    durationMin: t.durationMin ?? (t.start || t.end ? undefined : prev?.durationMin),
    approximate: approximate || t.approximate || t.earlier || t.later || prev?.approximate || undefined,
  };
}

/** Build a week from what was said. Unsaid days stay unknown (or off when the player listed their days). */
export function buildWeek(draft: WorkDraft, base?: WorkDayEntry[]): { days: WorkDayEntry[]; assumedDays: boolean } {
  const explicitDays = draft.days ?? draft.clauses.find((c) => c.days && c.days.length > 1)?.days;
  const assumedDays = !base && !explicitDays;
  const defaultDays = explicitDays ?? MON_FRI;
  const days: WorkDayEntry[] = base ? structuredClone(base) : blankWeek(explicitDays ? { kind: 'off' } : { kind: 'unknown' });
  if (!base) for (const i of defaultDays) days[i] = { kind: 'work' };
  for (const c of draft.clauses) {
    const targets = c.days && (c.days.length < 5 || !explicitDays || c.days === explicitDays) ? c.days : defaultDays;
    for (const i of targets) days[i] = mergeTimes(days[i], c.times, draft.approximate);
  }
  for (const i of draft.offDays) days[i] = { kind: 'off' };
  return { days, assumedDays };
}

function scheduleProposal(ctx: AssistantContext, days: WorkDayEntry[], from: ISODate, opts: { assumedDays?: boolean; variable?: boolean; merge?: boolean }): CoachReply {
  const starts = from <= ctx.today ? 'Starts today' : `Starts ${d(from)}`;
  const partial = days.some((x) => x.kind === 'work' && (!x.start || !x.end));
  const notes: string[] = [];
  if (opts.assumedDays) notes.push('I assumed Monday–Friday: tap the days to adjust. Weekend stays not set.');
  if (partial) notes.push('Missing times stay empty — I won’t guess them.');
  return {
    text: opts.merge ? 'Got it. Here’s your week with that change:' : 'Got it. I found a new recurring schedule.',
    proposal: {
      id: ctx.newId(),
      title: opts.merge ? 'Updated work week' : 'New work schedule',
      lines: [...summarizeSchedule(days), starts],
      changes: [{ type: 'work_schedule', days, effectiveFrom: from, variable: opts.variable }],
      note: notes.join(' ') || undefined,
      assumedDays: opts.assumedDays,
      status: 'pending',
    },
  };
}

function temporaryProposal(ctx: AssistantContext, dates: ISODate[], entry: WorkDayEntry): CoachReply {
  const label = describeEntry(entry);
  return {
    text: dates.length === 1 ? `Got it — just for ${dates[0] === ctx.today ? 'today' : d(dates[0])}.` : 'Got it — for those days only.',
    proposal: {
      id: ctx.newId(),
      title: dates.length === 1 ? 'One-off schedule' : 'Temporary schedule',
      lines: dates.slice(0, 7).map((x) => `${x === ctx.today ? 'Today' : d(x)} · ${entry.kind === 'off' ? 'day off' : label}`),
      changes: [{ type: 'temporary_work', dates, entry }],
      note: 'Your regular week stays the same.',
      status: 'pending',
    },
  };
}

function datesOf(scope: Extract<Scope, { kind: 'dates' }>, days?: number[]): ISODate[] {
  const all = dateRange(scope.from, scope.to).slice(0, 14);
  if (all.length === 1) return all;
  const filter = days?.length ? days : MON_FRI;
  return all.filter((x) => filter.includes(weekday(x)));
}

const HOURS_EXAMPLES = 'For example “9–18”, “from 8:30” or “until 14”.';
const HELP_QUICK: QuickReply[] = [
  { label: 'Plan my day', value: 'text:Plan my day' },
  { label: 'I don’t know my hours yet', value: 'text:I don’t know my work schedule yet' },
  { label: 'No gym this week', value: 'text:No gym this week' },
  { label: 'What do you know about me?', value: 'text:What do you know about me?' },
];

/** The schedule a weekday change builds on: the newest version, even if it starts in the future. */
function baseSchedule(ctx: AssistantContext): { days: WorkDayEntry[]; from: ISODate } | undefined {
  if (ctx.settings.work.status !== 'set') return undefined;
  const latest = [...ctx.settings.work.schedules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  return latest ? { days: latest.days, from: latest.effectiveFrom > ctx.today ? latest.effectiveFrom : ctx.today } : undefined;
}

// ——— Handlers ———

function handleWork(i: Extract<Intent, { type: 'work_hours' }>, ctx: AssistantContext): CoachReply {
  const approximate = i.times.approximate;
  const clauses = i.clauses.length ? i.clauses : [{ days: i.days?.days, times: i.times }];
  const draft: WorkDraft = { clauses, offDays: i.offDays, days: i.days && i.days.days.length > 1 ? i.days.days : undefined, approximate, variable: i.variable };
  const active = activeSchedule(ctx.settings.work, ctx.today);

  if (i.variable && !clauses.some((c) => c.times.start || c.times.end)) {
    return scheduleProposal(ctx, blankWeek(), ctx.today, { variable: true });
  }

  // One-off dates ("tomorrow 10–20", "this Friday I finish at 14").
  if (i.scope?.kind === 'dates') {
    const dates = datesOf(i.scope, i.days?.days);
    const base = active?.days[weekday(dates[0])];
    const entry = mergeTimes(base, clauses[0].times, approximate);
    if (!entry.start && !entry.end && !entry.durationMin && (clauses[0].times.earlier || clauses[0].times.later)) {
      return { text: `What time ${clauses[0].times.earlier ? 'do you finish' : 'do you start'} on ${d(dates[0])}? ${HOURS_EXAMPLES}`, pending: { kind: 'hours', scope: i.scope, days: i.days?.days } };
    }
    return temporaryProposal(ctx, dates, entry);
  }

  // A recurring change to specific weekdays ("il mercoledì finisco prima").
  const recurringDays = i.days?.recurring && i.days.days.length < 5 && !i.days.specific;
  if (recurringDays && !(i.scope?.kind === 'recurring' && clauses.some((c) => !c.days))) {
    const t = clauses[0].times;
    const days = i.days!.days;
    if (!t.start && !t.end && !t.durationMin && (t.earlier || t.later)) {
      const verb = t.earlier ? 'finish' : 'start';
      return {
        text: `What time do you ${verb} on ${days.map((x) => WEEKDAY_NAMES[x]).join(' and ')}s?`,
        quick: [
          ...(t.earlier ? ['13:00', '14:00', '15:00', '16:00'] : ['10:00', '11:00', '12:00', '13:00']).map((h) => ({ label: h, value: `${t.earlier ? 'end' : 'start'}:${h}` })),
          { label: 'Not sure yet', value: `${t.earlier ? 'end' : 'start'}:unknown` },
        ],
        pending: { kind: 'end_time', days, from: i.scope?.kind === 'recurring' ? i.scope.from : (baseSchedule(ctx)?.from ?? ctx.today) },
      };
    }
    const base = baseSchedule(ctx);
    const { days: week } = buildWeek(draft, base?.days ?? blankWeek());
    const from = i.scope?.kind === 'recurring' ? i.scope.from : (base?.from ?? ctx.today);
    return scheduleProposal(ctx, week, from, { merge: !!base, variable: i.variable });
  }

  // A new regular week.
  if (i.scope?.kind === 'recurring' || i.future || (i.days && i.days.days.length > 1)) {
    const { days, assumedDays } = buildWeek(draft);
    return scheduleProposal(ctx, days, i.scope?.kind === 'recurring' ? i.scope.from : ctx.today, { assumedDays, variable: i.variable });
  }

  // Ambiguous: times but no idea whether it's every week or just one day.
  return {
    text: 'Is that your regular schedule, or just for one day?',
    quick: [
      { label: 'Regular (every week)', value: 'scope:regular' },
      { label: 'Just today', value: 'scope:today' },
      { label: 'Just tomorrow', value: 'scope:tomorrow' },
    ],
    pending: { kind: 'scope_hours', draft },
  };
}

function exceptionReply(ctx: AssistantContext, kind: ExceptionKind, scope: Scope | undefined, title: string, lines: string[], note?: string): CoachReply {
  const from = scope?.from ?? ctx.today;
  const to = scope?.kind === 'dates' ? scope.to : scope?.kind === 'recurring' ? undefined : ctx.today;
  const when = to ? (from === to ? (from === ctx.today ? 'today' : d(from)) : `${d(from)} – ${d(to)}`) : `from ${d(from)}`;
  return {
    text: 'Understood.',
    proposal: { id: ctx.newId(), title: `${title} · ${when}`, lines, changes: [{ type: 'exception', kind, from, to, note: when }], note, status: 'pending' },
  };
}

function goalsProposal(ctx: AssistantContext, goals: string[]): CoachReply {
  const current = ctx.settings.profile.goals;
  const next = [...goals, ...current.filter((g) => !goals.includes(g))];
  const bodyGoal: BodyGoal | undefined = goals.includes('fat_loss') ? 'lose' : goals.includes('muscle') ? 'gain' : undefined;
  return {
    text: `New focus: ${goals.map(goalLabel).join(' + ')}.`,
    proposal: {
      id: ctx.newId(),
      title: `Focus on ${goals.map(goalLabel).join(' & ')}`,
      lines: [`Main goals: ${next.map(goalLabel).join(', ')}`, 'Side quests and challenges lean toward it', ...(bodyGoal ? [`Body goal: ${bodyGoal === 'lose' ? 'lose fat' : 'gain muscle'} (targets change only with your approval)`] : [])],
      changes: [{ type: 'goals', goals: next, focus: goals[0], bodyGoal }],
      status: 'pending',
    },
  };
}

function simple(ctx: AssistantContext, title: string, lines: string[], changes: ConfigChange[], text = 'Got it.'): CoachReply {
  return { text, proposal: { id: ctx.newId(), title, lines, changes, status: 'pending' } };
}

function handleIntent(i: Intent, ctx: AssistantContext): CoachReply | undefined {
  switch (i.type) {
    case 'work_unknown':
      if (ctx.settings.work.status === 'set') {
        return simple(ctx, 'Work schedule: not sure', ['Your current schedule is kept in history but no longer used', 'Days are planned from your energy and history'], [{ type: 'work_status', status: 'unknown' }], 'No problem.');
      }
      return { text: 'No problem. I’ll leave your work schedule empty for now. Tell me when you know — even partially.', proposal: { id: ctx.newId(), title: 'Work schedule: not sure yet', lines: ['Nothing to fill in'], changes: [{ type: 'work_status', status: 'unknown' }], status: 'applied' } };
    case 'work_none':
      return scheduleProposal(ctx, blankWeek({ kind: 'off' }), i.scope?.from ?? ctx.today, {});
    case 'work_started':
      return { text: `Congrats on the new job! 🎉 What are your hours? ${HOURS_EXAMPLES}`, quick: [{ label: 'Not sure yet', value: 'hours:unknown' }], pending: { kind: 'hours', scope: { kind: 'recurring', from: ctx.today } } };
    case 'work_hours':
      return handleWork(i, ctx);
    case 'day_off': {
      if (i.scope?.kind === 'dates') return temporaryProposal(ctx, datesOf(i.scope, i.days?.days), { kind: 'off' });
      if (i.days?.recurring) {
        const base = baseSchedule(ctx);
        const week = base ? structuredClone(base.days) : blankWeek();
        for (const x of i.days.days) week[x] = { kind: 'off' };
        return scheduleProposal(ctx, week, i.scope?.from ?? base?.from ?? ctx.today, { merge: !!base });
      }
      return temporaryProposal(ctx, [ctx.today], { kind: 'off' });
    }
    case 'no_gym':
      return exceptionReply(ctx, 'no_gym', i.scope ?? { kind: 'dates', from: ctx.today, to: ctx.today }, 'No gym', ['Strength workouts paused', 'Cardio and home activities stay available'], 'Your program resumes right after. Streaks are safe.');
    case 'training_days':
      return i.days === 'unknown'
        ? simple(ctx, 'Flexible training', ['One session whenever a day allows it', '3 per week, never two days in a row'], [{ type: 'training', days: 'unknown' }])
        : simple(ctx, 'Training days', [i.days.map((x) => WEEKDAY_NAMES[x]).join(' · ')], [{ type: 'training', days: i.days }]);
    case 'time_budget':
      return exceptionReply(
        ctx,
        i.direction === 'more' ? 'more_time' : 'less_time',
        i.scope ?? { kind: 'recurring', from: ctx.today },
        i.direction === 'more' ? 'More free time' : 'Less free time',
        [i.direction === 'more' ? 'Daily capacity +25%: more room for side quests' : 'Daily capacity −25%: core first, fewer extras'],
        'Adjust or remove it any time in Settings → Schedule.',
      );
    case 'load_mode': {
      if (i.mode === 'light') return exceptionReply(ctx, 'less_time', i.scope, 'Lighter day', ['Fewer extras, core quests stay'], 'Rest is part of the game.');
      if (!i.scope) {
        return {
          text: i.mode === 'push' ? 'Love it. For how long?' : 'Sure — for how long should I keep everything?',
          quick: [
            { label: 'Today', value: 'mode:today' },
            { label: 'This week', value: 'mode:week' },
            { label: 'Always', value: 'mode:always' },
          ],
          pending: { kind: 'mode_scope', mode: i.mode },
        };
      }
      return exceptionReply(ctx, i.mode, i.scope, i.mode === 'push' ? 'Push mode' : 'Keep every quest', i.mode === 'push' ? ['Nothing gets trimmed on full days', 'Extra side quests offered'] : ['Nothing gets trimmed on full days'], 'Safety limits still apply.');
    }
    case 'leave_as_is':
      return { text: 'OK — nothing changes.', action: 'dismiss_last' };
    case 'goals':
      if (i.changedOnly) {
        return {
          text: 'What do you want to focus on now?',
          quick: ['strength', 'fat_loss', 'muscle', 'endurance', 'routine', 'sleep'].map((g) => ({ label: goalLabel(g), value: `goal:${g}` })),
          pending: { kind: 'goal_choice' },
        };
      }
      return goalsProposal(ctx, i.goals);
    case 'wake':
      return i.time ? simple(ctx, `Wake-up ${i.time}`, ['Morning quests and reminders start from here'], [{ type: 'wake', time: i.time }]) : { text: 'Fine — I’ll keep estimating your wake-up time.', proposal: { id: ctx.newId(), title: 'Wake-up: not sure', lines: [], changes: [{ type: 'wake' }], status: 'pending' } };
    case 'sleep':
      return i.time ? simple(ctx, `Bedtime ${i.time}`, ['Night routine and quiet hours follow it'], [{ type: 'sleep', time: i.time }]) : { text: 'Fine — I’ll keep estimating your bedtime.', proposal: { id: ctx.newId(), title: 'Bedtime: not sure', lines: [], changes: [{ type: 'sleep' }], status: 'pending' } };
    case 'weight':
      return simple(ctx, `Weight ${i.kg} kg`, ['Logged for today (trends matter, single days don’t)'], [{ type: 'weight', kg: i.kg }]);
    case 'height':
      return simple(ctx, `Height ${i.cm} cm`, ['Used for nutrition targets'], [{ type: 'height', cm: i.cm }]);
    case 'steps':
      if (!i.value) return simple(ctx, 'Steps: calibrating', ['Log steps for 5 days and I’ll propose a target from your real average'], [{ type: 'steps' }], 'No problem.');
      {
        const ideal = Math.round((i.value * 1.05) / 250) * 250;
        return simple(ctx, `Step target ${ideal.toLocaleString('en-US')}`, [`Just above your ~${i.value.toLocaleString('en-US')}`, 'Grows slowly, only with your approval'], [{ type: 'steps', ideal }]);
      }
    case 'plan_day':
      if (ctx.todayWork.status === 'unknown') {
        return { text: 'Do you know your work schedule for today?', quick: [{ label: 'YES', value: 'plan:yes' }, { label: 'NOT YET', value: 'plan:no' }], pending: { kind: 'plan_known' } };
      }
      return { text: 'Here’s your day:', action: 'plan_summary' };
    case 'keep_quest': {
      const q = ctx.lightened.find((x) => x.title.toLowerCase().includes(i.query.trim()));
      if (q) return simple(ctx, `Keep “${q.title}”`, ['Back to its normal priority', 'Balancing won’t touch it again today'], [{ type: 'keep_quest', questId: q.id, title: q.title }], 'Your call.');
      if (!ctx.lightened.length) return { text: 'Nothing has been lightened today — every quest is at full priority.' };
      return { text: 'Which one do you want to keep?', quick: ctx.lightened.slice(0, 5).map((x) => ({ label: x.title, value: `keep:${x.id}` })), pending: { kind: 'keep_choice' } };
    }
    case 'status':
      return { text: 'Here’s what I know so far:', action: 'status' };
    case 'help':
      return {
        text: 'I help you configure LifeForge by chat. Tell me things like “from Monday I work 8–18”, “tomorrow I work 10–20”, “Wednesday I finish earlier”, “no gym this week”, “from October I’ll have more time” or “I want to focus on strength”. I always show a preview first.',
        quick: HELP_QUICK,
      };
    case 'greeting':
      return { text: 'Hey! What changed in your life? I can update your schedule, goals or plan today.', quick: HELP_QUICK };
    case 'thanks':
      return { text: 'Anytime. Go get that XP. ⚡' };
    case 'yes':
      return ctx.hasPendingProposal ? { text: 'Applying it.', action: 'confirm_last' } : undefined;
    case 'no':
      return ctx.hasPendingProposal ? { text: 'OK — nothing changes.', action: 'dismiss_last' } : { text: 'OK.' };
    case 'not_sure':
      return undefined;
  }
}

// ——— Pending answers ———

function answerPending(p: Pending, input: { text: string; value?: string }, intents: Intent[], ctx: AssistantContext): CoachReply | undefined {
  const v = input.value ?? '';
  const notSure = v.endsWith(':unknown') || intents.some((i) => i.type === 'not_sure' || i.type === 'work_unknown');
  const workIntent = intents.find((i): i is Extract<Intent, { type: 'work_hours' }> => i.type === 'work_hours');
  const bareTimes = (): TimeInfo | undefined => {
    const probe = parseMessage(`lavoro ${input.text}`, ctx.today).find((i): i is Extract<Intent, { type: 'work_hours' }> => i.type === 'work_hours');
    return probe?.times;
  };

  switch (p.kind) {
    case 'hours': {
      if (notSure) return handleIntent({ type: 'work_unknown' }, ctx);
      const times = workIntent?.times ?? bareTimes();
      if (!times || (!times.start && !times.end && !times.durationMin)) return { text: `I didn’t catch the hours. ${HOURS_EXAMPLES}`, pending: p, quick: [{ label: 'Not sure yet', value: 'hours:unknown' }] };
      if (p.scope?.kind === 'dates') {
        const dates = datesOf(p.scope, p.days);
        return temporaryProposal(ctx, dates, mergeTimes(activeSchedule(ctx.settings.work, ctx.today)?.days[weekday(dates[0])], times, false));
      }
      const i: Extract<Intent, { type: 'work_hours' }> = workIntent ?? { type: 'work_hours', times, clauses: [{ times }], offDays: [], future: true };
      return handleWork({ ...i, scope: p.scope ?? { kind: 'recurring', from: ctx.today }, future: true }, ctx);
    }
    case 'end_time': {
      const active = baseSchedule(ctx);
      const week = active ? structuredClone(active.days) : blankWeek();
      const [field, value] = v.split(':').length >= 2 ? [v.split(':')[0], v.slice(v.indexOf(':') + 1)] : ['', ''];
      const times = value && value !== 'unknown' ? { [field]: value } : (workIntent?.times ?? bareTimes());
      for (const day of p.days) {
        const prev = week[day];
        const base: WorkDayEntry = prev.kind === 'work' ? prev : { kind: 'work' };
        week[day] = notSure
          ? { ...base, ...(field === 'start' ? { start: undefined } : { end: undefined }), approximate: true }
          : mergeTimes(base, { approximate: false, ...(times as Partial<TimeInfo>) }, false);
      }
      return scheduleProposal(ctx, week, p.from, { merge: !!active });
    }
    case 'scope_hours': {
      const pick = v || (/(sempre|regolare|regular|every|ogni settimana|always)/i.test(input.text) ? 'scope:regular' : /domani|tomorrow/i.test(input.text) ? 'scope:tomorrow' : /oggi|today/i.test(input.text) ? 'scope:today' : '');
      if (pick === 'scope:regular') {
        const { days, assumedDays } = buildWeek(p.draft);
        return scheduleProposal(ctx, days, ctx.today, { assumedDays, variable: p.draft.variable });
      }
      if (pick === 'scope:today' || pick === 'scope:tomorrow') {
        const date = pick === 'scope:today' ? ctx.today : shiftDate(ctx.today, 1);
        return temporaryProposal(ctx, [date], mergeTimes(undefined, p.draft.clauses[0]?.times ?? { approximate: false }, p.draft.approximate));
      }
      return undefined;
    }
    case 'goal_choice': {
      const g = v.startsWith('goal:') ? [v.slice(5)] : (intents.find((i) => i.type === 'goals') as Extract<Intent, { type: 'goals' }> | undefined)?.goals;
      return g?.length ? goalsProposal(ctx, g) : undefined;
    }
    case 'plan_known':
      if (v === 'plan:no' || notSure || intents.some((i) => i.type === 'no')) {
        return { text: 'No problem — here’s a provisional plan. Tell me your hours any time and I’ll rebalance.', action: 'plan_summary' };
      }
      if (v === 'plan:yes' || intents.some((i) => i.type === 'yes')) {
        return { text: `What are your hours today? ${HOURS_EXAMPLES}`, pending: { kind: 'hours', scope: { kind: 'dates', from: ctx.today, to: ctx.today } }, quick: [{ label: 'Not sure after all', value: 'plan:no' }] };
      }
      if (workIntent) return answerPending({ kind: 'hours', scope: { kind: 'dates', from: ctx.today, to: ctx.today } }, input, intents, ctx);
      return undefined;
    case 'mode_scope': {
      const pick = v || (/sempre|always/i.test(input.text) ? 'mode:always' : /settimana|week/i.test(input.text) ? 'mode:week' : /oggi|today/i.test(input.text) ? 'mode:today' : '');
      if (pick === 'mode:always') {
        return simple(ctx, p.mode === 'push' ? 'Push mode · always' : 'Keep every quest · always', ['Nothing gets trimmed on full days', 'Change it in Settings → Schedule'], [{ type: 'load_mode', mode: p.mode }]);
      }
      if (pick === 'mode:week') return handleIntent({ type: 'load_mode', mode: p.mode, scope: { kind: 'dates', from: ctx.today, to: shiftDate(weekStart(ctx.today), 6) } }, ctx);
      if (pick === 'mode:today') return handleIntent({ type: 'load_mode', mode: p.mode, scope: { kind: 'dates', from: ctx.today, to: ctx.today } }, ctx);
      return undefined;
    }
    case 'keep_choice': {
      const id = v.startsWith('keep:') ? v.slice(5) : ctx.lightened.find((x) => x.title.toLowerCase().includes(input.text.toLowerCase()))?.id;
      const q = ctx.lightened.find((x) => x.id === id);
      return q ? handleIntent({ type: 'keep_quest', query: q.title.toLowerCase() }, ctx) : undefined;
    }
  }
}

// ——— Entry point ———

/**
 * Turn a chat message into a reply. Pure: it never changes data — every change is a
 * `Proposal` the player applies (or dismisses) explicitly.
 */
export function respond(input: { text: string; value?: string }, ctx: AssistantContext, pending?: Pending): CoachReply & { understood: boolean } {
  const text = input.value?.startsWith('text:') ? input.value.slice(5) : input.text;
  const intents = parseMessage(text, ctx.today);

  if (pending) {
    const answered = answerPending(pending, { text, value: input.value?.startsWith('text:') ? undefined : input.value }, intents, ctx);
    if (answered) return { ...answered, understood: true };
  }

  const replies = intents.map((i) => handleIntent(i, ctx)).filter((r): r is CoachReply => !!r);
  if (!replies.length) {
    return {
      understood: false,
      text: 'I’m not sure I got that. Without Gemini I can log water (“ho bevuto 500 ml”), complete quests, and update your work schedule, one-off days, gym availability, targets, goals, wake/bed times, weight and steps. Food estimates and open questions need Gemini.',
      quick: HELP_QUICK,
    };
  }
  // Several things in one message: merge the proposals into one preview.
  const proposals = replies.filter((r) => r.proposal && r.proposal.status === 'pending').map((r) => r.proposal!);
  if (proposals.length > 1) {
    return {
      understood: true,
      text: 'Got it — a few changes:',
      proposal: {
        id: ctx.newId(),
        title: proposals.map((p) => p.title).join(' + '),
        lines: proposals.flatMap((p) => p.lines),
        changes: proposals.flatMap((p) => p.changes),
        note: proposals.map((p) => p.note).filter(Boolean).join(' '),
        assumedDays: proposals.some((p) => p.assumedDays),
        status: 'pending',
      },
    };
  }
  const main = replies.find((r) => r.proposal || r.pending || r.action) ?? replies[0];
  const extra = replies.filter((r) => r !== main && !r.proposal && !r.pending && !r.action).map((r) => r.text);
  return { ...main, text: [main.text, ...extra].join(' '), understood: true };
}

/** Apply an edited day selection to a proposal with assumed days. */
export function withWorkDays(p: Proposal, workDays: number[]): Proposal {
  const changes = p.changes.map((c) => {
    if (c.type !== 'work_schedule') return c;
    const template = c.days.find((x) => x.kind === 'work') ?? { kind: 'work' as const };
    const days = c.days.map((x, i): WorkDayEntry => (workDays.includes(i) ? (x.kind === 'work' ? x : { ...template }) : x.kind === 'work' ? { kind: 'unknown' } : x));
    return { ...c, days };
  });
  const sched = changes.find((c) => c.type === 'work_schedule');
  return { ...p, changes, lines: sched && sched.type === 'work_schedule' ? [...summarizeSchedule(sched.days), p.lines.at(-1) ?? ''] : p.lines };
}

export { nextWeekday };
