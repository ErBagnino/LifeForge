import { describe, expect, it } from 'vitest';
import { findDate, ruleIntent } from '../ruleIntents';

const TODAY = '2026-09-23'; // Wednesday

describe('basic-coach tool intents', () => {
  it('asks before any reset', () => {
    const r = ruleIntent('Voglio ricominciare da zero', TODAY);
    expect(r).toMatchObject({ kind: 'ask', text: 'Do you want to reset your game progress only, or all historical data too?' });
    if (r?.kind === 'ask') expect(r.quick.map((q) => q.value)).toEqual(['tool:resetGameProgress', 'tool:resetAllData', 'text:No, keep everything']);
  });

  it('nutrition and water targets', () => {
    expect(ruleIntent('Porta le proteine a 150g', TODAY)).toMatchObject({ kind: 'tools', calls: [{ name: 'updateNutritionTargets', args: { protein: 150 } }] });
    expect(ruleIntent('Set my calories to 2.300 kcal', TODAY)).toMatchObject({ calls: [{ args: { calories: 2300 } }] });
    expect(ruleIntent('Voglio bere 2,5 litri di acqua al giorno', TODAY)).toMatchObject({ calls: [{ name: 'updateWaterGoal', args: { targetMl: 2500 } }] });
    expect(ruleIntent('Ho mangiato 600 kcal', TODAY)).toBeUndefined();
  });

  it('one-time vs recurring', () => {
    const one = ruleIntent('Domani alle 18 dentista', TODAY);
    expect(one).toMatchObject({ kind: 'tools', calls: [{ name: 'scheduleOneTimeActivity', args: { title: 'Dentista', date: '2026-09-24', time: '18:00', category: 'personal_care' } }] });
    const rec = ruleIntent('Ogni lunedì e giovedì chitarra 30 minuti', TODAY);
    expect(rec).toMatchObject({ calls: [{ name: 'createActivity', args: { name: 'Chitarra', recurrence: { type: 'weekdays', days: [1, 4] }, durationMin: 30 } }] });
    expect(ruleIntent('Corsa 3 volte a settimana', TODAY)).toMatchObject({ calls: [{ name: 'createActivity', args: { name: 'Corsa', category: 'cardio', recurrence: { type: 'timesPerWeek', times: 3 } } }] });
    expect(ruleIntent('Domani lavoro dalle 10 alle 20', TODAY)).toBeUndefined(); // work → schedule parser
  });

  it('achievement for N workouts', () => {
    expect(ruleIntent('Crea un achievement per 50 allenamenti', TODAY)).toMatchObject({ calls: [{ name: 'createAchievement', args: { counter: 'workouts.completed', threshold: 50 } }] });
  });

  it('resolves specific dates', () => {
    expect(findDate('il 21 febbraio', TODAY)).toBe('2027-02-21');
    expect(findDate('venerdi', TODAY)).toBe('2026-09-25');
    expect(findDate('dopodomani', TODAY)).toBe('2026-09-25');
  });
});
