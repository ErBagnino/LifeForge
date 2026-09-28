import { describe, expect, it } from 'vitest';
import { coachCommand, memoryIntent } from '../coachCommands';

describe('coach commands', () => {
  it.each([
    ['What should I do right now?', 'right_now'],
    ['cosa faccio adesso?', 'right_now'],
    ['How much time do I actually have today?', 'time_left'],
    ['quanto tempo mi resta oggi?', 'time_left'],
    ['Plan my evening', 'plan_evening'],
    ['organizza la mia serata', 'plan_evening'],
    ['Prepare tomorrow', 'prepare_tomorrow'],
    ['cosa mi aspetta domani?', 'prepare_tomorrow'],
    ['Show me what I have postponed', 'postponed'],
    ['mostrami le cose rimandate', 'postponed'],
    ['Help me recover from a bad day', 'bad_day'],
    ['oggi è stata una giornata storta', 'bad_day'],
  ])('%s → %s', (text, cmd) => {
    expect(coachCommand(text)).toBe(cmd);
  });

  it.each(['From Monday I work 9-18', 'Tomorrow I work 10-20', 'I drank 500 ml', 'I did the laundry', 'set my water goal to 2 litres', 'what should I do today'])('leaves "%s" to the normal parser', (text) => {
    expect(coachCommand(text)).toBeUndefined();
  });
});

describe('memory intents', () => {
  it('remember / recall / forget in both languages', () => {
    expect(memoryIntent('Remember that I hate running')).toEqual({ kind: 'remember', text: 'I hate running' });
    expect(memoryIntent('ricorda che il martedì gioco a calcetto')).toEqual({ kind: 'remember', text: 'Il martedì gioco a calcetto' });
    expect(memoryIntent('What do you remember about me?')).toEqual({ kind: 'recall' });
    expect(memoryIntent('cosa ricordi di me?')).toEqual({ kind: 'recall' });
    expect(memoryIntent('Forget the running note.')).toEqual({ kind: 'forget', query: 'the running note' });
  });
  it('does not treat reminders or ordinary talk as memory', () => {
    expect(memoryIntent('remember to buy milk')).toBeUndefined();
    expect(memoryIntent('Remind me to call mum tomorrow')).toBeUndefined();
    expect(memoryIntent('I remember my first workout')).toBeUndefined();
  });
});

describe('memory vs reminders (Italian)', () => {
  it('"ricordati di…" is a to-do, not a memory', () => {
    expect(memoryIntent('ricordati di chiamare mamma')).toBeUndefined();
    expect(memoryIntent('ricordami di comprare il latte')).toBeUndefined();
    expect(memoryIntent('ricordati che odio correre')).toEqual({ kind: 'remember', text: 'Odio correre' });
  });
});
