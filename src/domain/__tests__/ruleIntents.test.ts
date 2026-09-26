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

describe('on-device commands (no AI call)', () => {
  const quests = [
    { id: 'q1', title: 'Drink water (2.3 L)' },
    { id: 'q5', title: "Change Sky's water" },
    { id: 'q6', title: 'Drink a glass of water' },
    { id: 'q2', title: 'Upper A workout' },
    { id: 'q3', title: 'Read 20 pages' },
    { id: 'q4', title: 'Read an article' },
  ];
  it('matches a single pending quest, IT/EN, with synonyms', async () => {
    const { completionIntent } = await import('../ruleIntents');
    expect(completionIntent('Segna acqua completata', quests)).toEqual({ name: 'completeQuest', args: { questId: 'q1' } });
    expect(completionIntent('Ho fatto la palestra', quests)).toEqual({ name: 'completeQuest', args: { questId: 'q2' } });
    expect(completionIntent('mark reading done', quests)).toBeUndefined(); // two "read" quests → ambiguous, don't guess
    expect(completionIntent('Come sto andando?', quests)).toBeUndefined();
  });
  it('logs water the player drank, on the device; negations, plans and questions log nothing', async () => {
    const { ruleIntent, isLocalCommand } = await import('../ruleIntents');
    expect(ruleIntent('Ho bevuto 500ml', TODAY)).toMatchObject({ kind: 'tools', calls: [{ name: 'logWater', args: { ml: 500 } }] });
    expect(ruleIntent("Ho bevuto un litro d'acqua", TODAY)).toMatchObject({ calls: [{ name: 'logWater', args: { ml: 1000 } }] });
    expect(ruleIntent('I drank 1.5 l of water', TODAY)).toMatchObject({ calls: [{ name: 'logWater', args: { ml: 1500 } }] });
    expect(isLocalCommand('Ho bevuto 500ml', TODAY, quests)).toBe(true);
    // regression: '2.5 litri' was read as 25 litres
    expect(ruleIntent("Porta l'obiettivo acqua a 2.5 litri", TODAY)).toMatchObject({ calls: [{ name: 'updateWaterGoal', args: { targetMl: 2500 } }] });
    for (const s of ['Non ho bevuto 500 ml', 'Domani berrò 2 litri', 'Ho bevuto 500 ml?', "Voglio bere 2 litri d'acqua al giorno"]) {
      const r = ruleIntent(s, TODAY);
      expect(r && 'calls' in r ? r.calls.map((c) => c.name) : []).not.toContain('logWater');
    }
  });
  it('never completes on a negation, a question or a plan (regression: "Non ho fatto il workout" completed it)', async () => {
    const { completionIntent } = await import('../ruleIntents');
    for (const s of ['non ho fatto palestra', 'domani farò palestra', 'Non ho fatto il workout', "I didn't do the workout", 'Ho fatto la palestra?', 'Domani faccio la palestra', 'Devo ancora fare la palestra', 'Not done with the workout', 'Se ho tempo faccio la palestra']) expect(completionIntent(s, quests)).toBeUndefined();
  });
  it('isLocalCommand: targets, reset clarification and completions stay on the device', async () => {
    const { isLocalCommand } = await import('../ruleIntents');
    expect(isLocalCommand('Porta le calorie a 1900 kcal', TODAY, quests)).toBe(true);
    expect(isLocalCommand('Segna acqua completata', TODAY, quests)).toBe(true);
    expect(isLocalCommand('Voglio ricominciare da zero', TODAY, quests)).toBe(true);
    expect(isLocalCommand('Crea una challenge basata sui miei progressi', TODAY, quests)).toBe(false);
    expect(isLocalCommand('Organizzami la settimana', TODAY, quests)).toBe(false);
  });
});
