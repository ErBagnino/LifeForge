import { describe, expect, it } from 'vitest';
import { type AssistantContext, type ConfigChange, respond, withWorkDays } from '../coachAssistant';
import { createDefaultSettings } from '@/data/defaultSettings';
import type { Settings, WorkDayEntry } from '@/types';

const TODAY = '2026-09-23'; // Wednesday
let n = 0;
function ctx(settings: Settings = createDefaultSettings(), extra: Partial<AssistantContext> = {}): AssistantContext {
  return { today: TODAY, settings, todayWork: { status: 'unknown', source: 'none' }, lightened: [], hasPendingProposal: false, newId: () => `p${++n}`, ...extra };
}
const withWork = (days: WorkDayEntry[]): Settings => ({ ...createDefaultSettings(), work: { status: 'set', schedules: [{ id: 'a', effectiveFrom: '2000-01-01', days, source: 'settings', createdAt: 0 }] } });
const MON_FRI_8_18: WorkDayEntry[] = [{ kind: 'off' }, ...Array.from({ length: 5 }, () => ({ kind: 'work' as const, start: '08:00', end: '18:00' })), { kind: 'off' }];
const change = <T extends ConfigChange['type']>(r: ReturnType<typeof respond>, type: T) => r.proposal?.changes.find((c) => c.type === type) as Extract<ConfigChange, { type: T }> | undefined;

describe('coach assistant', () => {
  it('"Da lunedì lavoro dalle 9 alle 18" → preview MON–FRI 09:00–18:00 from Monday, weekend not assumed', () => {
    const r = respond({ text: 'Da lunedì lavoro dalle 9 alle 18.' }, ctx());
    expect(r.text).toMatch(/new recurring schedule/i);
    expect(r.proposal?.lines).toContain('Mon–Fri 09:00–18:00');
    expect(r.proposal?.lines).toContain('Weekend not set');
    expect(r.proposal?.assumedDays).toBe(true);
    expect(change(r, 'work_schedule')?.effectiveFrom).toBe('2026-09-28');
  });

  it('"Probabilmente lavorerò dalle 9" keeps the end unknown', () => {
    const r = respond({ text: 'Probabilmente lavorerò dalle 9.' }, ctx());
    const mon = change(r, 'work_schedule')!.days[1];
    expect(mon).toMatchObject({ kind: 'work', start: '09:00', approximate: true });
    expect(mon.kind === 'work' && mon.end).toBeUndefined();
    expect(r.proposal?.lines[0]).toBe('Mon–Fri from ~09:00 · end not set');
  });

  it('"Il mercoledì finisco prima" asks for the time, then updates only Wednesday', () => {
    const c = ctx(withWork(MON_FRI_8_18));
    const q = respond({ text: 'Il mercoledì finisco prima.' }, c);
    expect(q.proposal).toBeUndefined();
    expect(q.quick?.map((x) => x.label)).toContain('Not sure yet');
    const a = respond({ text: '14:00', value: 'end:14:00' }, c, q.pending);
    const week = change(a, 'work_schedule')!.days;
    expect(week[3]).toMatchObject({ start: '08:00', end: '14:00' });
    expect(week[2]).toMatchObject({ start: '08:00', end: '18:00' });
    const unsure = respond({ text: 'Not sure yet', value: 'end:unknown' }, c, q.pending);
    const wed = change(unsure, 'work_schedule')!.days[3];
    expect(wed).toMatchObject({ kind: 'work', start: '08:00', approximate: true });
    expect(wed.kind === 'work' && wed.end).toBeUndefined();
  });

  it('a weekday change builds on a schedule that starts in the future', () => {
    const future: Settings = { ...createDefaultSettings(), work: { status: 'set', schedules: [{ id: 'f', effectiveFrom: '2026-09-28', days: MON_FRI_8_18, source: 'coach', createdAt: 0 }] } };
    const q = respond({ text: 'Il mercoledì finisco prima.' }, ctx(future));
    const a = respond({ text: '14:00', value: 'end:14:00' }, ctx(future), q.pending);
    const c = change(a, 'work_schedule')!;
    expect(c.effectiveFrom).toBe('2026-09-28');
    expect(c.days[3]).toMatchObject({ start: '08:00', end: '14:00' });
    expect(c.days[1]).toMatchObject({ start: '08:00', end: '18:00' });
  });

  it('"Domani lavoro dalle 10 alle 20" is a temporary schedule', () => {
    const r = respond({ text: 'Domani lavoro dalle 10 alle 20.' }, ctx(withWork(MON_FRI_8_18)));
    expect(change(r, 'temporary_work')).toEqual({ type: 'temporary_work', dates: ['2026-09-24'], entry: expect.objectContaining({ start: '10:00', end: '20:00' }) });
    expect(r.proposal?.note).toMatch(/regular week stays/);
  });

  it('"Non so ancora quando lavorerò" leaves it empty without asking to invent', () => {
    const r = respond({ text: 'Non so ancora quando lavorerò.' }, ctx());
    expect(r.text).toMatch(/leave your work schedule empty/);
    expect(r.proposal?.status).toBe('applied');
  });

  it('"Organizzami la giornata" asks about today when work is unknown, NOT YET → provisional plan', () => {
    const q = respond({ text: 'Organizzami la giornata.' }, ctx());
    expect(q.text).toBe('Do you know your work schedule for today?');
    expect(q.quick?.map((x) => x.label)).toEqual(['YES', 'NOT YET']);
    const no = respond({ text: 'NOT YET', value: 'plan:no' }, ctx(), q.pending);
    expect(no.action).toBe('plan_summary');
    const yes = respond({ text: 'YES', value: 'plan:yes' }, ctx(), q.pending);
    const hours = respond({ text: '9-17' }, ctx(), yes.pending);
    expect(change(hours, 'temporary_work')).toMatchObject({ dates: [TODAY], entry: { start: '09:00', end: '17:00' } });
  });

  it('asks whether bare hours are regular or one-off', () => {
    const q = respond({ text: 'lavoro dalle 9 alle 18' }, ctx());
    expect(q.text).toMatch(/regular schedule, or just for one day/);
    const r = respond({ text: 'Just tomorrow', value: 'scope:tomorrow' }, ctx(), q.pending);
    expect(change(r, 'temporary_work')?.dates).toEqual(['2026-09-24']);
  });

  it('combines several changes in one preview', () => {
    const r = respond({ text: 'Da lunedì lavoro 8-18 e questa settimana niente palestra' }, ctx());
    expect(r.proposal?.changes.map((c) => c.type).sort()).toEqual(['exception', 'work_schedule']);
  });

  it('goals, load modes and time budgets', () => {
    const g = respond({ text: 'Il mio obiettivo è cambiato.' }, ctx());
    const g2 = respond({ text: 'Strength', value: 'goal:strength' }, ctx(), g.pending);
    expect(change(g2, 'goals')).toMatchObject({ focus: 'strength' });
    const m = respond({ text: 'Non ridurre le attività.' }, ctx());
    const m2 = respond({ text: 'This week', value: 'mode:week' }, ctx(), m.pending);
    expect(change(m2, 'exception')).toMatchObject({ kind: 'keep_all', from: TODAY, to: '2026-09-27' });
    const t = respond({ text: 'Da ottobre avrò più tempo.' }, ctx());
    expect(change(t, 'exception')).toMatchObject({ kind: 'more_time', from: '2026-10-01' });
    expect(change(t, 'exception')?.to).toBeUndefined();
  });

  it('respects "no" and "leave it as is" on a pending proposal', () => {
    expect(respond({ text: 'Lascia tutto com’è.' }, ctx(undefined, { hasPendingProposal: true })).action).toBe('dismiss_last');
    expect(respond({ text: 'Non mi va' }, ctx(undefined, { hasPendingProposal: true })).action).toBe('dismiss_last');
    expect(respond({ text: 'sì' }, ctx(undefined, { hasPendingProposal: true })).action).toBe('confirm_last');
  });

  it('keeps a lightened quest by name', () => {
    const r = respond({ text: 'Voglio comunque fare la lettura' }, ctx(undefined, { lightened: [{ id: 'q1', title: 'Read 20 pages' }, { id: 'q2', title: 'Lettura 20 minuti' }] }));
    expect(change(r, 'keep_quest')?.questId).toBe('q2');
  });

  it('admits when it does not understand instead of inventing', () => {
    const r = respond({ text: 'qual è la capitale della Francia?' }, ctx());
    expect(r.understood).toBe(false);
    expect(r.proposal).toBeUndefined();
  });

  it('editable assumed days', () => {
    const r = respond({ text: 'Da lunedì lavoro dalle 9 alle 18.' }, ctx());
    const edited = withWorkDays(r.proposal!, [1, 2, 3, 4]);
    const days = (edited.changes[0] as Extract<ConfigChange, { type: 'work_schedule' }>).days;
    expect(days[5]).toEqual({ kind: 'unknown' });
    expect(edited.lines[0]).toBe('Mon–Thu 09:00–18:00');
  });
});
