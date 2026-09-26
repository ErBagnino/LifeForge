import { type AssistantContext, type ConfigChange, type Pending, type Proposal, type QuickReply, respond, withWorkDays } from '@/domain/coachAssistant';
import { ruleIntent, type RuleToolCall } from '@/domain/ruleIntents';
import { profileFields } from '@/domain/profile';
import { describeWork, resolveEntry, summarizeSchedule, workFromPlan } from '@/domain/schedule';
import { metaRepository, questRepository, settingsRepository, statsRepository } from '@/repositories';
import type { DayPlan, FieldStatus, ISODate, Settings, WorkDayEntry } from '@/types';
import { formatDate } from '@/utils/date';
import { uid } from '@/utils/id';
import { saveSettings } from './adminService';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { planFor } from './game/dayPlan';
import { rebuildDay } from './game/dayService';
import { keepQuest } from './game/questService';
import { logMetric } from './metricsService';
import {
  addException,
  addWorkSchedule,
  assignTrainingDays,
  newSchedule,
  previewRebalance,
  setLoadMode,
  setTemporaryWork,
  setWorkUnknown,
  temporaryPlan,
  withSchedule,
} from './scheduleService';

export interface InfoLine {
  icon?: string;
  label: string;
  value?: string;
  status?: FieldStatus;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
  ts: number;
  proposal?: Proposal;
  quick?: QuickReply[];
  info?: InfoLine[];
  /** Answered by Gemini rather than the on-device parser. */
  ai?: boolean;
  /** Tool actions proposed in this message (preview → confirm → apply). */
  actions?: ActionCard[];
  /** A problem to show with this message (quota, connection…). */
  notice?: { kind: string; text: string };
  /** The user attached a photo (the photo itself is not kept). */
  photo?: boolean;
}

export type ActionStatus = 'pending' | 'applied' | 'cancelled' | 'failed' | 'undone';

/** A tool call shown as a card. The call is re-validated when the user applies it. */
export interface ActionCard {
  id: string;
  /** Index of the Gemini function call this card answers (undefined for the basic coach). */
  callIndex?: number;
  name: string;
  args: Record<string, unknown>;
  permission: 'read' | 'low' | 'write' | 'destructive';
  title: string;
  lines: { label: string; before?: string; after?: string }[];
  warnings: string[];
  confirmPhrase?: string;
  undoable: boolean;
  status: ActionStatus;
  result?: string;
  changeId?: string;
}

/** A Gemini turn paused while the user confirms actions. */
export interface AwaitingTurn {
  messageId: string;
  contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[];
  calls: { id?: string; name: string; args: Record<string, unknown>; result?: Record<string, unknown> }[];
  step: number;
}

export interface ChatState {
  messages: ChatMessage[];
  pending?: Pending;
  /** Short text-only memory of the Gemini conversation (quota-friendly). */
  transcript?: { role: 'user' | 'model'; text: string }[];
  awaiting?: AwaitingTurn;
}

const KEY = 'coachChat';
const MAX = 80;

export async function loadChat(): Promise<ChatState> {
  return (await metaRepository.get<ChatState>(KEY)) ?? { messages: [] };
}

export async function save(state: ChatState): Promise<ChatState> {
  const trimmed = { ...state, messages: state.messages.slice(-MAX) };
  await metaRepository.set(KEY, trimmed);
  return trimmed;
}

export async function clearChat(): Promise<ChatState> {
  return save({ messages: [] });
}

export function welcomeMessage(s: Settings): ChatMessage {
  const work = s.work.status === 'set' ? 'I know your work schedule' : 'your work schedule isn’t set — totally fine';
  return {
    id: uid('m_'),
    role: 'coach',
    ts: Date.now(),
    text: `Hi ${s.profile.nickname || 'there'}! I’m your LifeForge Coach. Tell me what changes in your life and I’ll update the game — always with a preview first. Right now ${work}.`,
    quick: [
      { label: 'Plan my day', value: 'text:Plan my day' },
      { label: 'From Monday I work 9–18', value: 'text:From Monday I work 9 to 18' },
      { label: 'No gym this week', value: 'text:No gym this week' },
      { label: 'What do you know about me?', value: 'text:What do you know about me?' },
    ],
  };
}

const lastPendingProposal = (state: ChatState) => [...state.messages].reverse().find((m) => m.proposal?.status === 'pending');

// ——— Hypothetical settings (for previews) ———

/** What settings would look like after `changes` (pure; nothing is saved). */
export function applyToSettings(s: Settings, changes: ConfigChange[]): Settings {
  let next = structuredClone(s);
  for (const c of changes) {
    switch (c.type) {
      case 'work_status':
        next.work = { ...next.work, status: c.status };
        break;
      case 'work_schedule':
        next.work = withSchedule(next.work, newSchedule(c.days, c.effectiveFrom, 'coach', { variable: c.variable }));
        break;
      case 'exception':
        next.exceptions = [...next.exceptions, { id: 'preview', kind: c.kind, from: c.from, to: c.to, createdAt: 0 }];
        break;
      case 'load_mode':
        next.load = { mode: c.mode };
        break;
      case 'wake':
        next = c.time ? { ...next, schedule: { ...next.schedule, wake: c.time }, known: { ...next.known, wake: 'set' } } : { ...next, known: { ...next.known, wake: 'unknown' } };
        break;
      case 'sleep':
        next = c.time ? { ...next, schedule: { ...next.schedule, sleep: c.time }, known: { ...next.known, sleep: 'set' } } : { ...next, known: { ...next.known, sleep: 'unknown' } };
        break;
      default:
        break;
    }
  }
  return next;
}

export async function impactOf(proposal: Proposal, settings: Settings, today: ISODate): Promise<string[]> {
  const touchesToday = proposal.changes.some(
    (c) =>
      (c.type === 'work_schedule' && c.effectiveFrom <= today) ||
      (c.type === 'temporary_work' && c.dates.includes(today)) ||
      (c.type === 'exception' && c.from <= today && (!c.to || c.to >= today)) ||
      c.type === 'load_mode' ||
      c.type === 'work_status' ||
      c.type === 'wake' ||
      c.type === 'sleep',
  );
  const future = proposal.changes.find((c): c is Extract<ConfigChange, { type: 'exception' }> => c.type === 'exception' && c.from > today);
  const sched = proposal.changes.find((c) => c.type === 'work_schedule' && c.effectiveFrom > today) as Extract<ConfigChange, { type: 'work_schedule' }> | undefined;
  const lines: string[] = [];
  if (proposal.changes.some((c) => c.type === 'work_schedule' || c.type === 'temporary_work' || c.type === 'work_status')) lines.push('This will affect your daily workload.');
  if (sched) lines.push(`Takes effect ${formatDate(sched.effectiveFrom, 'EEE d MMM')} — today stays as planned.`);
  else if (future) lines.push(`Starts ${formatDate(future.from, 'EEE d MMM')}.`);
  if (!touchesToday) return lines;
  try {
    const hypothetical = applyToSettings(settings, proposal.changes);
    const temp = proposal.changes.find((c) => c.type === 'temporary_work' && c.dates.includes(today)) as Extract<ConfigChange, { type: 'temporary_work' }> | undefined;
    const plan: DayPlan | undefined = temp ? temporaryPlan(await planFor(today, settings), temp.entry) : undefined;
    const p = await previewRebalance(hypothetical, today, plan);
    const up = p.changes.filter((c) => rank(c.to) > rank(c.from)).length;
    const down = p.changes.filter((c) => rank(c.to) < rank(c.from)).length;
    lines.push(`Today: load ${p.before.score} → ${p.after.score} (${p.after.level}) · capacity ~${Math.round(p.after.capacity / 5) * 5} min`);
    if (down) lines.push(`${down} quest${down > 1 ? 's' : ''} become a no-pressure bonus`);
    if (up) lines.push(`${up} quest${up > 1 ? 's' : ''} back to full priority`);
    if (p.sideSlots) lines.push(`Room for up to ${p.sideSlots} side quest${p.sideSlots > 1 ? 's' : ''}`);
  } catch {
    // Preview is best-effort: applying still works.
  }
  return lines;
}

const rank = (t: string) => (t === 'core' ? 3 : t === 'important' ? 2 : 1);

// ——— Summaries ———

async function planSummary(today: ISODate): Promise<InfoLine[]> {
  const quests = (await questRepository.byDate(today)).filter((q) => q.status === 'pending' && !q.goal && !q.hidden);
  const order = (t?: string) => t ?? '99:99';
  const tierIcon = { core: '⭐', important: '🔷', optional: '✨' } as const;
  const lines: InfoLine[] = quests
    .sort((a, b) => rank(b.tier) - rank(a.tier) || order(a.scheduledTime).localeCompare(order(b.scheduledTime)))
    .slice(0, 8)
    .map((q) => ({ icon: q.icon, label: q.title, value: `${q.scheduledTime ?? 'anytime'} · ${tierIcon[q.tier]}` }));
  if (!lines.length) lines.push({ icon: '🎉', label: 'Everything for today is done' });
  return lines;
}

function statusSummary(s: Settings, today: ISODate): InfoLine[] {
  return profileFields(s, today).map((f) => ({ icon: f.icon, label: f.label, value: f.value, status: f.status }));
}


export function describeChanges(changes: ConfigChange[], today: ISODate): string[] {
  return changes.flatMap((c): string[] => {
    switch (c.type) {
      case 'work_schedule':
        return [...summarizeSchedule(c.days), c.effectiveFrom > today ? `Starts ${formatDate(c.effectiveFrom, 'EEE d MMM')}` : 'Starts today'];
      case 'temporary_work':
        return c.dates.map((d) => `${formatDate(d, 'EEE d MMM')} · ${c.entry.kind === 'off' ? 'day off' : describeWork(resolveEntry(c.entry))}`);
      case 'exception':
        return [`${c.kind.replace('_', ' ')} · ${c.to ? `${c.from} → ${c.to}` : `from ${c.from}`}`];
      case 'work_status':
        return ['Work schedule: not sure yet'];
      default:
        return [c.type.replace('_', ' ')];
    }
  });
}

// ——— Conversation ———

/** Turn basic-coach tool calls into action cards (validated + previewed, nothing applied). */
export async function ruleCards(calls: RuleToolCall[]): Promise<ActionCard[]> {
  const { prepare } = await import('./ai/tools/registry');
  const cards: ActionCard[] = [];
  for (const call of calls) {
    const p = await prepare(call);
    if (!p.ok) {
      cards.push({ id: uid('a_'), name: call.name, args: call.args, permission: 'write', title: call.name, lines: [], warnings: [], undoable: false, status: 'failed', result: p.result.message });
    } else if (p.kind === 'action') {
      const a = p.action;
      cards.push({ id: uid('a_'), name: a.call.name, args: a.call.args, permission: a.permission, title: a.title, lines: a.lines, warnings: a.warnings, confirmPhrase: a.confirmPhrase, undoable: a.undoable, status: 'pending' });
    }
  }
  return cards;
}

export async function sendMessage(state: ChatState, input: { text: string; value?: string }): Promise<{ state: ChatState; result?: ServiceResult }> {
  const settings = await settingsRepository.get();
  if (!settings) throw new Error('Game not initialised');
  const today = clock.today();
  const plan = await planFor(today, settings);
  const lightened = (await questRepository.byDate(today)).filter((q) => q.lightened && q.status === 'pending').map((q) => ({ id: q.id, title: q.title }));
  const pendingProposal = lastPendingProposal(state);
  const ctx: AssistantContext = { today, settings, todayWork: workFromPlan(plan), lightened, hasPendingProposal: !!pendingProposal, newId: () => uid('p_') };

  let messages: ChatMessage[] = [...state.messages, { id: uid('m_'), role: 'user', text: input.text, ts: Date.now() }];
  const reply = respond(input, ctx, state.pending);
  const coach: ChatMessage = { id: uid('m_'), role: 'coach', text: reply.text, ts: Date.now(), quick: reply.quick };
  let result: ServiceResult | undefined;

  if (input.value?.startsWith('tool:')) {
    // Quick reply that names a tool (e.g. the reset clarification).
    const name = input.value.slice(5);
    coach.text = 'Check this before confirming:';
    coach.quick = undefined;
    coach.actions = await ruleCards([{ name, args: {} }]);
  } else if (!reply.understood) {
    const intent = ruleIntent(input.text, today);
    if (intent?.kind === 'ask') {
      coach.text = intent.text;
      coach.quick = intent.quick;
    } else if (intent?.kind === 'tools') {
      coach.text = intent.text;
      coach.quick = undefined;
      const cards = await ruleCards(intent.calls);
      const failed = cards.filter((a) => a.status === 'failed');
      coach.actions = cards.filter((a) => a.status !== 'failed');
      // A call that can't be previewed (already set, out of bounds…) is explained in text, not as a card.
      if (failed.length) coach.text = coach.actions.length ? `${intent.text} (${failed.map((a) => a.result).join(' ')})` : failed.map((a) => a.result).join(' ');
      if (!coach.actions.length) coach.actions = undefined;
    }
  }

  if (reply.action === 'dismiss_last' && pendingProposal) {
    messages = messages.map((m) => (m.id === pendingProposal.id ? { ...m, proposal: { ...m.proposal!, status: 'dismissed' as const } } : m));
  }
  if (reply.action === 'confirm_last' && pendingProposal) {
    const applied = await applyProposal({ ...state, messages }, pendingProposal.proposal!.id);
    return { state: await save({ ...applied.state, pending: undefined }), result: applied.result };
  }
  if (reply.action === 'plan_summary') coach.info = await planSummary(today);
  if (reply.action === 'status') coach.info = statusSummary(settings, today);

  if (reply.proposal) {
    coach.proposal = reply.proposal;
    if (reply.proposal.status === 'applied') result = await applyChanges(reply.proposal.changes);
  }
  if (coach.proposal?.status === 'pending') coach.proposal = { ...coach.proposal, impact: await impactOf(coach.proposal, settings, today) };
  messages.push(coach);
  return { state: await save({ messages, pending: reply.pending }), result };
}

export async function applyProposal(state: ChatState, proposalId: string): Promise<{ state: ChatState; result: ServiceResult }> {
  const msg = state.messages.find((m) => m.proposal?.id === proposalId);
  if (!msg?.proposal || msg.proposal.status !== 'pending') return { state, result: { events: [] } };
  const before = (await settingsRepository.get())!;
  const today = clock.today();
  const result = await applyChanges(msg.proposal.changes);
  const after = (await settingsRepository.get())!;
  const log = await statsRepository.getLog(today);
  const done: ChatMessage = {
    id: uid('m_'),
    role: 'coach',
    ts: Date.now(),
    text: `Done ✓ ${msg.proposal.title}.${log ? ` Today’s load is now ${log.workload} (${log.workloadLevel}).` : ''}`,
    quick: before.work.status !== after.work.status || msg.proposal.changes.some((c) => c.type === 'work_schedule') ? [{ label: 'Plan my day', value: 'text:Plan my day' }] : undefined,
  };
  const messages = state.messages.map((m) => (m.id === msg.id ? { ...m, proposal: { ...m.proposal!, status: 'applied' as const } } : m));
  return { state: await save({ ...state, messages: [...messages, done], pending: undefined }), result };
}

export async function dismissProposal(state: ChatState, proposalId: string): Promise<ChatState> {
  const messages = state.messages.map((m) => (m.proposal?.id === proposalId ? { ...m, proposal: { ...m.proposal, status: 'dismissed' as const } } : m));
  return save({ ...state, messages: [...messages, { id: uid('m_'), role: 'coach', ts: Date.now(), text: 'OK — nothing changes.' }], pending: undefined });
}

export async function editProposalDays(state: ChatState, proposalId: string, workDays: number[]): Promise<ChatState> {
  const settings = (await settingsRepository.get())!;
  const messages = await Promise.all(
    state.messages.map(async (m) => {
      if (m.proposal?.id !== proposalId) return m;
      const proposal = withWorkDays(m.proposal, workDays);
      return { ...m, proposal: { ...proposal, impact: await impactOf(proposal, settings, clock.today()) } };
    }),
  );
  return save({ ...state, messages });
}

/** Apply confirmed changes through the regular services (each rebalances today when relevant). */
export async function applyChanges(changes: ConfigChange[]): Promise<ServiceResult> {
  const events: ServiceResult['events'] = [];
  const push = (r: ServiceResult) => events.push(...r.events);
  const today = clock.today();
  for (const c of changes) {
    const s = (await settingsRepository.get())!;
    switch (c.type) {
      case 'work_status':
        push(await setWorkUnknown());
        break;
      case 'work_schedule':
        push(await addWorkSchedule(newSchedule(c.days as WorkDayEntry[], c.effectiveFrom, 'coach', { variable: c.variable })));
        break;
      case 'temporary_work':
        for (const d of c.dates) push(await setTemporaryWork(d, c.entry, 'Set with the Coach'));
        break;
      case 'exception':
        push(await addException({ kind: c.kind, from: c.from, to: c.to, note: c.note }));
        break;
      case 'load_mode':
        push(await setLoadMode(c.mode));
        break;
      case 'goals':
        await saveSettings({
          ...s,
          profile: { ...s.profile, goals: c.goals, focus: c.focus, fitnessGoals: c.goals.filter((g) => ['strength', 'fat_loss', 'muscle', 'endurance'].includes(g)) },
          body: c.bodyGoal ? { ...s.body, goal: c.bodyGoal } : s.body,
          known: { ...s.known, goals: 'set' },
        });
        push(await rebuildDay(today));
        break;
      case 'wake':
      case 'sleep':
        await saveSettings(applyToSettings(s, [c]));
        push(await rebuildDay(today));
        break;
      case 'weight':
        await saveSettings({ ...s, body: { ...s.body, weightKg: c.kg }, known: { ...s.known, weight: 'set' } });
        push(await logMetric('weight', c.kg, { mode: 'set', source: 'manual' }));
        break;
      case 'height':
        await saveSettings({ ...s, body: { ...s.body, heightCm: c.cm }, known: { ...s.known, height: 'set' } });
        break;
      case 'steps':
        await saveSettings(
          c.ideal
            ? { ...s, steps: { ideal: c.ideal, min: Math.round((c.ideal * 0.85) / 250) * 250, stretch: Math.round((c.ideal * 1.3) / 250) * 250 }, known: { ...s.known, steps: 'set' } }
            : { ...s, known: { ...s.known, steps: 'unknown' } },
        );
        break;
      case 'training':
        push(await assignTrainingDays(c.days));
        break;
      case 'keep_quest':
        push(await keepQuest(c.questId));
        break;
    }
  }
  return { events };
}
