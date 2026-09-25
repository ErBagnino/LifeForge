import { z } from 'zod';
import { type AssistantContext, type ConfigChange, type Pending, type Proposal, type QuickReply, respond, withWorkDays } from '@/domain/coachAssistant';
import { profileFields } from '@/domain/profile';
import { activeSchedule, describeWork, resolveEntry, summarizeSchedule, workFromPlan } from '@/domain/schedule';
import { metaRepository, questRepository, settingsRepository, statsRepository } from '@/repositories';
import type { DayPlan, FieldStatus, ISODate, Settings, WorkDayEntry } from '@/types';
import { formatDate } from '@/utils/date';
import { uid } from '@/utils/id';
import { aiReady, callTool } from './ai/claude';
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
  /** Answered by the optional AI model rather than the on-device parser. */
  ai?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  pending?: Pending;
}

const KEY = 'coachChat';
const MAX = 80;

export async function loadChat(): Promise<ChatState> {
  return (await metaRepository.get<ChatState>(KEY)) ?? { messages: [] };
}

async function save(state: ChatState): Promise<ChatState> {
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

async function impactOf(proposal: Proposal, settings: Settings, today: ISODate): Promise<string[]> {
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

// ——— Optional AI fallback ———

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Entry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('off') }),
  z.object({ kind: z.literal('unknown') }),
  z.object({ kind: z.literal('work'), start: Time.optional(), end: Time.optional(), breakMin: z.number().int().min(0).max(240).optional(), durationMin: z.number().int().min(30).max(900).optional(), approximate: z.boolean().optional() }),
]);
const ChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('work_status'), status: z.literal('unknown') }),
  z.object({ type: z.literal('work_schedule'), days: z.array(Entry).length(7).describe('Index 0 = Sunday … 6 = Saturday'), effectiveFrom: Iso, variable: z.boolean().optional() }),
  z.object({ type: z.literal('temporary_work'), dates: z.array(Iso).min(1).max(14), entry: Entry }),
  z.object({ type: z.literal('exception'), kind: z.enum(['no_gym', 'more_time', 'less_time', 'keep_all', 'push']), from: Iso, to: Iso.optional(), note: z.string().max(80).optional() }),
  z.object({ type: z.literal('load_mode'), mode: z.enum(['auto', 'keep_all', 'push']) }),
  z.object({ type: z.literal('goals'), goals: z.array(z.enum(['strength', 'fat_loss', 'muscle', 'endurance', 'routine', 'nofap', 'screen', 'sleep', 'nutrition', 'order', 'learning', 'mind', 'pet'])).min(1), focus: z.string().optional() }),
  z.object({ type: z.literal('wake'), time: Time.optional() }),
  z.object({ type: z.literal('sleep'), time: Time.optional() }),
  z.object({ type: z.literal('weight'), kg: z.number().min(30).max(300) }),
  z.object({ type: z.literal('height'), cm: z.number().min(120).max(230) }),
  z.object({ type: z.literal('steps'), ideal: z.number().int().min(2000).max(25000).optional() }),
  z.object({ type: z.literal('training'), days: z.union([z.array(z.number().int().min(0).max(6)), z.literal('unknown')]) }),
]);
const AiReply = z.object({
  reply: z.string().max(600),
  question: z.boolean().optional(),
  quick_replies: z.array(z.string().max(40)).max(5).optional(),
  changes: z.array(ChangeSchema).max(6).optional(),
});

function aiSystem(s: Settings, today: ISODate): string {
  const sch = activeSchedule(s.work, today);
  return [
    'You are the LifeForge Coach, a configuration assistant inside a personal life-RPG app. Reply in English, briefly and warmly.',
    `Today is ${today} (${formatDate(today, 'EEEE')}).`,
    `Work schedule: ${s.work.status === 'set' && sch ? summarizeSchedule(sch.days).join(', ') : s.work.status}. Goals: ${s.profile.goals.join(', ') || 'not set'}.`,
    'Rules: only propose changes the user actually stated. NEVER invent missing times — leave start/end undefined when unknown (e.g. "probably from 9" = start 09:00, approximate, no end).',
    'A one-off day ("tomorrow I work 10-20") is temporary_work, not a new work_schedule. If the request is ambiguous, set question=true, ask one short question and propose no changes.',
    'Never encourage fasting, skipped meals, extreme restriction, punitive exercise or sleep deprivation. If asked, decline kindly.',
  ].join('\n');
}

async function askAi(text: string, s: Settings, today: ISODate): Promise<{ reply: string; quick?: QuickReply[]; changes?: ConfigChange[] } | undefined> {
  if (!aiReady(s.coach.ai.enabled, s.coach.ai.model)) return undefined;
  const raw = await callTool<unknown>({
    model: s.coach.ai.model,
    system: aiSystem(s, today),
    content: [{ type: 'text', text }],
    tool: { name: 'coach_reply', description: 'Reply to the user and optionally propose configuration changes for them to confirm.', input_schema: z.toJSONSchema(AiReply) as Record<string, unknown> },
  });
  const parsed = AiReply.safeParse(raw);
  if (!parsed.success) return { reply: 'I couldn’t turn that into a safe change. Could you rephrase it?' };
  return {
    reply: parsed.data.reply,
    quick: parsed.data.quick_replies?.map((q) => ({ label: q, value: `text:${q}` })),
    changes: parsed.data.question ? undefined : (parsed.data.changes as ConfigChange[] | undefined),
  };
}

function describeChanges(changes: ConfigChange[], today: ISODate): string[] {
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

  if (!reply.understood) {
    try {
      const ai = await askAi(input.text, settings, today);
      if (ai) {
        coach.text = ai.reply;
        coach.quick = ai.quick;
        coach.ai = true;
        if (ai.changes?.length) coach.proposal = { id: uid('p_'), title: 'Suggested change', lines: describeChanges(ai.changes, today), changes: ai.changes, status: 'pending', note: 'Proposed by the AI model — check it before applying.' };
      }
    } catch (e) {
      coach.text = `${reply.text} (AI fallback unavailable: ${(e as Error).message})`;
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
