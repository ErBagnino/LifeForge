import { describe, expect, it } from 'vitest';
import { findDays, findScope, findSteps, findTimes, findWeight, normalize, parseMessage, workClauses } from '../nlu';

const TODAY = '2026-09-23'; // Wednesday
const first = (text: string) => parseMessage(text, TODAY)[0];
const find = (text: string, type: string) => parseMessage(text, TODAY).find((i) => i.type === type);

describe('coach language: times', () => {
  it('reads ranges in Italian and English', () => {
    expect(findTimes(normalize('lavoro dalle 8 alle 18'))).toMatchObject({ start: '08:00', end: '18:00', approximate: false });
    expect(findTimes(normalize('I work 9 to 5'))).toMatchObject({ start: '09:00', end: '17:00' });
    expect(findTimes(normalize('dalle 8:30 alle 17.30'))).toMatchObject({ start: '08:30', end: '17:30' });
    expect(findTimes(normalize('9-18'))).toMatchObject({ start: '09:00', end: '18:00' });
    expect(findTimes(normalize('from 10am to 6pm'))).toMatchObject({ start: '10:00', end: '18:00' });
    expect(findTimes(normalize('dalle 8 e mezza alle 5'))).toMatchObject({ start: '08:30', end: '17:00' });
  });

  it('keeps partial information partial', () => {
    const p = findTimes(normalize('Probabilmente lavorerò dalle 9'));
    expect(p).toMatchObject({ start: '09:00', approximate: true });
    expect(p.end).toBeUndefined();
    expect(findTimes(normalize('il mercoledì finisco alle 14'))).toMatchObject({ end: '14:00' });
    expect(findTimes(normalize('il mercoledì finisco prima'))).toMatchObject({ earlier: true });
    expect(findTimes(normalize('il mercoledì finisco prima')).end).toBeUndefined();
    expect(findTimes(normalize('lavoro 6 ore al giorno'))).toMatchObject({ durationMin: 360 });
    expect(findTimes(normalize('9-18 con un\'ora di pausa'))).toMatchObject({ breakMin: 60 });
    expect(findTimes(normalize('30 minuti di pausa pranzo'))).toMatchObject({ breakMin: 30 });
  });
});

describe('coach language: days & scope', () => {
  it('reads day ranges and recurring days', () => {
    expect(findDays(normalize('dal lunedì al venerdì'))?.days).toEqual([1, 2, 3, 4, 5]);
    expect(findDays(normalize('mon-fri'))?.days).toEqual([1, 2, 3, 4, 5]);
    expect(findDays(normalize('il mercoledì'))).toMatchObject({ days: [3], recurring: true });
    expect(findDays(normalize('on Wednesdays'))).toMatchObject({ days: [3], recurring: true });
    expect(findDays(normalize('questo venerdì'))).toMatchObject({ days: [5], specific: true, recurring: false });
    expect(findDays(normalize('weekend'))?.days).toEqual([6, 0]);
  });

  it('resolves when things apply', () => {
    expect(findScope(normalize('domani'), TODAY)).toEqual({ kind: 'dates', from: '2026-09-24', to: '2026-09-24' });
    expect(findScope(normalize('da lunedì'), TODAY)).toEqual({ kind: 'recurring', from: '2026-09-28' });
    expect(findScope(normalize('from Monday'), TODAY)).toEqual({ kind: 'recurring', from: '2026-09-28' });
    expect(findScope(normalize('da ottobre'), TODAY)).toEqual({ kind: 'recurring', from: '2026-10-01' });
    expect(findScope(normalize('dal 5 ottobre'), TODAY)).toEqual({ kind: 'recurring', from: '2026-10-05' });
    expect(findScope(normalize('questa settimana'), TODAY)).toEqual({ kind: 'dates', from: TODAY, to: '2026-09-27' });
    expect(findScope(normalize('da questa settimana'), TODAY)).toEqual({ kind: 'recurring', from: TODAY });
    expect(findScope(normalize('la prossima settimana'), TODAY)).toEqual({ kind: 'dates', from: '2026-09-28', to: '2026-10-04' });
  });
});

describe('coach language: the spec examples', () => {
  it('"Ho iniziato a lavorare." asks for hours', () => {
    expect(first('Ho iniziato a lavorare.')).toEqual({ type: 'work_started' });
  });

  it('"Da lunedì lavoro dalle 8 alle 18." is a new recurring schedule (Monday is the start date, not the only day)', () => {
    const i = first('Da lunedì lavoro dalle 8 alle 18.');
    expect(i).toMatchObject({ type: 'work_hours', scope: { kind: 'recurring', from: '2026-09-28' }, times: { start: '08:00', end: '18:00' } });
    expect(i.type === 'work_hours' && i.days).toBeUndefined();
  });

  it('"Il mercoledì finisco prima." is a recurring Wednesday change with an unknown time', () => {
    expect(first('Il mercoledì finisco prima.')).toMatchObject({ type: 'work_hours', days: { days: [3], recurring: true }, times: { earlier: true } });
  });

  it('"Questa settimana non posso andare in palestra." blocks the gym this week', () => {
    expect(first('Questa settimana non posso andare in palestra.')).toEqual({ type: 'no_gym', scope: { kind: 'dates', from: TODAY, to: '2026-09-27' } });
  });

  it('"Da ottobre avrò più tempo." is a capacity change from October', () => {
    expect(first('Da ottobre avrò più tempo.')).toEqual({ type: 'time_budget', direction: 'more', scope: { kind: 'recurring', from: '2026-10-01' } });
  });

  it('"Non so ancora quando lavorerò." leaves work unknown', () => {
    expect(first('Non so ancora quando lavorerò.')).toEqual({ type: 'work_unknown' });
  });

  it('"Probabilmente lavorerò dalle 9." knows the start, not the end', () => {
    const i = first('Probabilmente lavorerò dalle 9.');
    expect(i).toMatchObject({ type: 'work_hours', future: true, times: { start: '09:00', approximate: true } });
    expect(i.type === 'work_hours' && i.times.end).toBeUndefined();
  });

  it('"Domani lavoro dalle 10 alle 20." is temporary', () => {
    expect(first('Domani lavoro dalle 10 alle 20.')).toMatchObject({ type: 'work_hours', scope: { kind: 'dates', from: '2026-09-24', to: '2026-09-24' }, times: { start: '10:00', end: '20:00' } });
  });

  it('goals, load and overrides', () => {
    expect(find('Adesso voglio concentrarmi maggiormente sulla forza.', 'goals')).toEqual({ type: 'goals', goals: ['strength'], changedOnly: false });
    expect(find('Il mio obiettivo è cambiato.', 'goals')).toEqual({ type: 'goals', goals: [], changedOnly: true });
    expect(find('Da questa settimana ho meno tempo.', 'time_budget')).toMatchObject({ direction: 'less', scope: { kind: 'recurring', from: TODAY } });
    expect(find('Questa settimana voglio spingere.', 'load_mode')).toMatchObject({ mode: 'push', scope: { kind: 'dates', to: '2026-09-27' } });
    expect(find('Non ridurre le attività.', 'load_mode')).toMatchObject({ mode: 'keep_all' });
    expect(first('Lascia tutto com’è.')).toEqual({ type: 'leave_as_is' });
    expect(first('Non mi va.')).toEqual({ type: 'no' });
    expect(first('Organizzami la giornata.')).toEqual({ type: 'plan_day' });
  });

  it('English works too', () => {
    expect(first('From Monday I work 9 to 6')).toMatchObject({ type: 'work_hours', scope: { kind: 'recurring', from: '2026-09-28' }, times: { start: '09:00', end: '18:00' } });
    expect(first("I don't know my work schedule yet")).toEqual({ type: 'work_unknown' });
    expect(first('no gym this week')).toMatchObject({ type: 'no_gym' });
    expect(first('tomorrow I am off')).toMatchObject({ type: 'day_off', scope: { from: '2026-09-24' } });
  });

  it('multi-clause weeks and exceptions', () => {
    const t = normalize('lavoro dal lunedì al venerdì 8-18, il mercoledì fino alle 14');
    expect(workClauses(t)).toEqual([
      { days: [1, 2, 3, 4, 5], times: expect.objectContaining({ start: '08:00', end: '18:00' }) },
      { days: [3], times: expect.objectContaining({ end: '14:00' }) },
    ]);
    const i = first('lavoro 9-17 tutti i giorni tranne il venerdì');
    expect(i.type === 'work_hours' && i.offDays).toEqual([5]);
  });

  it('body, rhythm and steps', () => {
    expect(findWeight(normalize('oggi peso 73,4 kg'))).toBe(73.4);
    expect(find('mi sveglio alle 6:45', 'wake')).toEqual({ type: 'wake', time: '06:45' });
    expect(find('vado a letto alle 11', 'sleep')).toEqual({ type: 'sleep', time: '23:00' });
    expect(findSteps(normalize('faccio circa 8.000 passi'))).toBe(8000);
    expect(findSteps(normalize('about 7k steps'))).toBe(7000);
  });
});
