import type { ISODate } from '@/types';
import { shiftDate } from '@/utils/date';
import { findDays, nextWeekday, normalize } from './nlu';

/**
 * Basic-coach intents that map to AI tools (used when Gemini is not available).
 * They produce the same tool calls Gemini would, so they go through the same
 * validation → preview → confirmation → game engine path. Deterministic and
 * conservative: when unsure, return undefined and let the normal parser answer.
 */

export interface RuleToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type RuleIntent =
  | { kind: 'tools'; text: string; calls: RuleToolCall[] }
  | { kind: 'ask'; text: string; quick: { label: string; value: string }[] };

const MONTHS: Record<string, number> = {
  gennaio: 1, january: 1, febbraio: 2, february: 2, marzo: 3, march: 3, aprile: 4, april: 4, maggio: 5, may: 5, giugno: 6, june: 6,
  luglio: 7, july: 7, agosto: 8, august: 8, settembre: 9, september: 9, ottobre: 10, october: 10, novembre: 11, november: 11, dicembre: 12, december: 12,
};

const CATEGORY_WORDS: [RegExp, string][] = [
  [/palestra|gym|allenamento|workout|pesi|weights/, 'fitness'],
  [/corsa|correre|run|running|cardio|bici|bike|nuoto|swim/, 'cardio'],
  [/leggere|lettura|read|reading|libro|book/, 'reading'],
  [/studiare|studio|study|corso|course|lezione|lesson/, 'online_learning'],
  [/pulire|pulizie|clean|cleaning|lavatrice|laundry|bucato/, 'cleaning'],
  [/meditare|meditazione|meditate|meditation|journal|diario/, 'mental_wellbeing'],
  [/cane|dog|gatto|cat\b|pet/, 'animal_care'],
  [/dentista|dentist|medico|doctor|barbiere|barber|parrucchiere|haircut|skincare/, 'personal_care'],
  [/amici|friends|cena con|dinner with|famiglia|family/, 'social'],
  [/camminata|walk|passeggiata|hike|escursione/, 'outdoor'],
  [/cucinare|cook|meal prep/, 'nutrition'],
];

function categoryOf(t: string): string {
  return CATEGORY_WORDS.find(([re]) => re.test(t))?.[1] ?? 'general';
}

function num(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** One specific date the user mentioned ("domani", "venerdì", "il 21 febbraio"). */
export function findDate(t: string, today: ISODate): ISODate | undefined {
  if (/\bdopodomani\b|\bday after tomorrow\b/.test(t)) return shiftDate(today, 2);
  if (/\bdomani\b|\btomorrow\b/.test(t)) return shiftDate(today, 1);
  if (/\boggi\b|\btoday\b|\bstasera\b|\btonight\b/.test(t)) return today;
  const dm = /\b(\d{1,2})\s+(?:di\s+)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(t) ?? /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/.exec(t);
  if (dm) {
    const [d, m] = /^\d/.test(dm[1]) ? [Number(dm[1]), MONTHS[dm[2]]] : [Number(dm[2]), MONTHS[dm[1]]];
    const [y] = today.split('-').map(Number);
    let iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso < today) iso = `${y + 1}-${iso.slice(5)}`;
    return iso;
  }
  const days = findDays(t);
  if (days && !days.recurring && days.days.length === 1) return nextWeekday(today, days.days[0]) === shiftDate(today, 7) ? today : nextWeekday(today, days.days[0]);
  return undefined;
}

function findTime(t: string): string | undefined {
  const m = /\b(?:alle|all'|ore|at)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/.exec(t);
  if (!m) return undefined;
  let h = Number(m[1]);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

function findDuration(t: string): number | undefined {
  const m = /\b(\d{1,3})\s*(?:min|minuti|minutes?)\b/.exec(t) ?? /\bper\s+(\d{1,2})\s*(?:ore|ora|h|hours?)\b|\bfor\s+(\d{1,2})\s*(?:hours?|h)\b/.exec(t);
  if (!m) return /\bun'?ora\b|\ban hour\b|\bone hour\b/.test(t) ? 60 : /mezz'?ora|half an hour/.test(t) ? 30 : undefined;
  if (/min/.test(m[0])) return Number(m[1]);
  return Number(m[1] ?? m[2]) * 60;
}

/** Strip date/time/duration words so what is left can serve as a title. */
function titleFrom(raw: string): string | undefined {
  const cleaned = raw
    .replace(/\b(ricordami di|remind me to|aggiungi|add|metti|schedule|programma|devo|i have to|i need to|voglio|i want to|fare|do|go to|andare (?:a|in|dal)|vado (?:a|in|dal))\b/gi, ' ')
    .replace(/\b(dopodomani|domani|oggi|stasera|tomorrow|today|tonight|day after tomorrow)\b/gi, ' ')
    .replace(/\b(ogni|every|tutti i|il|la|on|next|prossimo|questo|this)\s+(giorno|day|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, ' ')
    .replace(/\b(lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, ' ')
    .replace(/\b\d{1,2}\s+(di\s+)?(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, ' ')
    .replace(/\b(alle|all'|ore|at)\s*\d{1,2}([:.]\d{2})?\s*(am|pm)?\b/gi, ' ')
    .replace(/\b(per\s+)?\d{1,3}\s*(min|minuti|minutes?|ore|ora|h|hours?)\b/gi, ' ')
    .replace(/\b(\d+\s*volte a settimana|\d+\s*times a week|\d+x\/week)\b/gi, ' ')
    .replace(/[.!?,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:e|and|ed|il|la|lo|di|a|per|for|ogni|every)\s+)+/, '')
    .replace(/\s+(?:e|and|ed|il|la|lo|di|a|per|for)$/, '');
  if (cleaned.length < 2 || cleaned.length > 60) return undefined;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function ruleIntent(raw: string, today: ISODate): RuleIntent | undefined {
  const t = normalize(raw);

  // "Voglio ricominciare da zero" → always clarify first.
  if (/ricominciare da zero|ricominciare da capo|ripartire da zero|resetta(re)? tutto|cancella(re)? tutto|start (over|from scratch)|reset (everything|all)|wipe everything/.test(t)) {
    return {
      kind: 'ask',
      text: 'Do you want to reset your game progress only, or all historical data too?',
      quick: [
        { label: 'Game progress only', value: 'tool:resetGameProgress' },
        { label: 'All data too', value: 'tool:resetAllData' },
        { label: 'Cancel', value: 'text:No, keep everything' },
      ],
    };
  }

  // Nutrition / water targets
  const kcal = /(\d[\d.]{2,5})\s*(?:kcal|calorie|calories|cal)\b/.exec(t) ?? /(?:calorie|calories|kcal)[^\d]{0,20}(\d[\d.]{2,5})/.exec(t);
  const protein = /(\d{2,3})\s*g?\s*(?:di\s+)?(?:proteine|protein)/.exec(t) ?? /(?:proteine|protein)[^\d]{0,20}(\d{2,3})\s*g?\b/.exec(t);
  const target = /obiettivo|target|goal|imposta|set|porta|portare|metti|aumenta|increase|riduci|lower|cambia|change|voglio|want/.test(t);
  if (target && (kcal || protein) && !/\bmangiato\b|\bate\b|\bho preso\b/.test(t)) {
    const args: Record<string, unknown> = {};
    if (kcal) args.calories = Math.round(num(kcal[1]));
    if (protein) args.protein = Number(protein[1]);
    return { kind: 'tools', text: 'Here’s the change to your nutrition targets:', calls: [{ name: 'updateNutritionTargets', args }] };
  }
  const water = /(\d(?:[.,]\d)?)\s*(?:l|litri|litro|liters?|litres?)\b/.exec(t) ?? /(\d{3,4})\s*ml\b/.exec(t);
  if (target && water && /acqua|water|bere|drink|idrata|hydrat/.test(t)) {
    const ml = /ml/.test(water[0]) ? Number(water[1]) : Math.round(num(water[1]) * 1000);
    return { kind: 'tools', text: 'Here’s the new water target:', calls: [{ name: 'updateWaterGoal', args: { targetMl: ml } }] };
  }

  // Achievement for N workouts
  const ach = /(?:achievement|trofeo|medaglia|badge|traguardo)[^\d]{0,40}(\d{1,4})\s*(?:allenamenti|workouts?|sessioni)/.exec(t) ?? /(\d{1,4})\s*(?:allenamenti|workouts?)[^.]{0,30}(?:achievement|trofeo|medaglia|badge)/.exec(t);
  if (ach) {
    const n = Number(ach[1]);
    return { kind: 'tools', text: `An achievement for ${n} workouts:`, calls: [{ name: 'createAchievement', args: { name: `${n} Workouts`, description: `Complete ${n} strength workouts.`, counter: 'workouts.completed', threshold: n, icon: '🏋️' } }] };
  }

  // Recurring activity: "ogni lunedì e giovedì chitarra 30 minuti", "3 volte a settimana corsa"
  const times = /(\d)\s*(?:volte a settimana|volte alla settimana|times a week|times per week|x\/week)/.exec(t);
  const days = findDays(t);
  const everyDay = /ogni giorno|tutti i giorni|every ?day|daily/.test(t);
  if ((times || everyDay || (days?.recurring && /\bogni\b|\bevery\b|\btutti i\b/.test(t))) && !/lavor|work|turno|shift/.test(t)) {
    const title = titleFrom(t);
    if (!title) return undefined;
    const recurrence = times ? { type: 'timesPerWeek', times: Number(times[1]) } : everyDay ? { type: 'daily' } : { type: 'weekdays', days: days!.days };
    const time = findTime(t);
    return {
      kind: 'tools',
      text: 'A new recurring activity:',
      calls: [{ name: 'createActivity', args: { name: title, category: categoryOf(t), priority: 'optional', recurrence, durationMin: findDuration(t) ?? 30, ...(time ? { preferredTime: time } : {}) } }],
    };
  }

  // One-time activity: "domani alle 18 dentista", "venerdì palestra alle 19 per un'ora"
  const date = findDate(t, today);
  if (date && (findTime(t) || /ricordami|remind me|aggiungi|add|devo|have to|appuntamento|appointment/.test(t)) && !/lavor|work|turno|shift|palestra chiusa|no gym|stanco|tired/.test(t)) {
    const title = titleFrom(t);
    if (!title) return undefined;
    const time = findTime(t);
    return {
      kind: 'tools',
      text: 'A one-time activity (not recurring):',
      calls: [{ name: 'scheduleOneTimeActivity', args: { title, date, durationMin: findDuration(t) ?? 30, category: categoryOf(t), ...(time ? { time } : {}) } }],
    };
  }
  return undefined;
}

// ——— "Segna X completata" (handled on the device, no AI call) ———

const SYNONYMS: Record<string, string[]> = {
  acqua: ['drink water', 'water', 'hydrat', 'drink'],
  bere: ['drink water', 'water', 'drink'],
  palestra: ['workout', 'gym', 'upper', 'lower', 'train'],
  allenamento: ['workout', 'train', 'upper', 'lower'],
  passi: ['steps', 'walk'],
  camminata: ['walk', 'steps'],
  lettura: ['read'],
  leggere: ['read'],
  meditazione: ['meditat', 'mind'],
  stretching: ['stretch', 'mobility'],
  proteine: ['protein'],
  letto: ['bed', 'make'],
  cane: ['dog', 'walk'],
  pulizie: ['clean', 'tidy'],
  skincare: ['skin'],
  denti: ['teeth', 'floss'],
  doccia: ['shower'],
  sonno: ['sleep', 'bed'],
  nofap: ['nofap', 'porn', 'urge'],
};

const DONE_WORDS = /\b(segna|segnami|marca|metti|mark|complet\w*|ho fatto|ho finito|fatto|fatta|done|finished|check off|spunta)\b/;
const STOP = new Set(['segna', 'segnami', 'marca', 'metti', 'mark', 'come', 'as', 'completata', 'completato', 'completa', 'complete', 'completed', 'ho', 'fatto', 'fatta', 'finito', 'done', 'finished', 'la', 'il', 'lo', 'le', 'i', 'gli', 'di', 'the', 'my', 'quest', 'task', 'oggi', 'today', 'check', 'off', 'spunta', 'e', 'and', 'a', 'ad']);

/**
 * "Segna acqua completata", "ho fatto la palestra", "mark reading done" → the single
 * pending quest whose title matches. Ambiguous or no match → undefined (let the AI or
 * the normal parser answer instead of guessing).
 */
export function completionIntent(raw: string, quests: { id: string; title: string }[]): RuleToolCall | undefined {
  const t = normalize(raw);
  if (!DONE_WORDS.test(t) || t.length > 80) return undefined;
  const words = t
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return undefined;
  const keys = [...new Set(words.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]))];
  // Rank by match quality (phrase matches outweigh single words) and act only on a clear winner.
  const ranked = quests
    .map((q) => {
      const title = normalize(q.title);
      return { q, score: keys.filter((k) => title.includes(k)).reduce((sum, k) => sum + k.length, 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return undefined;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 5) return undefined;
  return { name: 'completeQuest', args: { questId: ranked[0].q.id } };
}

/** Commands the device can handle with certainty — no Gemini call needed even when it is connected. */
export function isLocalCommand(raw: string, today: ISODate, quests: { id: string; title: string }[]): boolean {
  if (completionIntent(raw, quests)) return true;
  const r = ruleIntent(raw, today);
  if (r?.kind === 'ask') return true;
  return r?.kind === 'tools' && r.calls.every((c) => c.name === 'updateNutritionTargets' || c.name === 'updateWaterGoal' || c.name === 'createAchievement');
}
