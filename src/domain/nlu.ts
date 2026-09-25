import type { ISODate, TimeHM } from '@/types';
import { shiftDate, weekday, weekStart } from '@/utils/date';

/**
 * A small, deterministic language layer for the Coach (Italian + English).
 * It extracts *only* what the player said: a start time without an end stays
 * a start time, "Wednesday I finish earlier" stays "earlier, time unknown".
 */

// ——— Text ———

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .replace(/(\d)\s*e mezz[ao]\b/g, '$1:30')
    .replace(/(\d)\s*e un quarto\b/g, '$1:15')
    .replace(/(\d)\s*e tre quarti\b/g, '$1:45')
    .replace(/\bmezzogiorno\b|\bnoon\b/g, '12:00')
    .replace(/\bmezzanotte\b|\bmidnight\b/g, '00:00')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

// ——— Weekdays ———

const DAY_WORDS: [RegExp, number][] = [
  [/\bdomenic[ah]e?\b|\bsundays?\b/, 0],
  [/\bluned[ii]?\b|\bmondays?\b/, 1],
  [/\bmarted[ii]?\b|\btuesdays?\b/, 2],
  [/\bmercoled[ii]?\b|\bwednesdays?\b/, 3],
  [/\bgioved[ii]?\b|\bthursdays?\b/, 4],
  [/\bvenerd[ii]?\b|\bfridays?\b/, 5],
  [/\bsabat[oi]\b|\bsaturdays?\b/, 6],
];
const DAY_TOKEN =
  '(domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|sunday|monday|tuesday|wednesday|thursday|friday|saturday|dom|lun|mar|mer|gio|ven|sab|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)';
const DAY_INDEX: Record<string, number> = {
  domenica: 0, dom: 0, sunday: 0, sun: 0,
  lunedi: 1, lun: 1, monday: 1, mon: 1,
  martedi: 2, mar: 2, tuesday: 2, tue: 2, tues: 2,
  mercoledi: 3, mer: 3, wednesday: 3, wed: 3,
  giovedi: 4, gio: 4, thursday: 4, thu: 4, thur: 4, thurs: 4,
  venerdi: 5, ven: 5, friday: 5, fri: 5,
  sabato: 6, sab: 6, saturday: 6, sat: 6,
};
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

function dayRange(a: number, b: number): number[] {
  const i = MON_FIRST.indexOf(a);
  const j = MON_FIRST.indexOf(b);
  return i <= j ? MON_FIRST.slice(i, j + 1) : [...MON_FIRST.slice(i), ...MON_FIRST.slice(0, j + 1)];
}

export interface DayMention {
  days: number[];
  /** "il mercoledì", "on Wednesdays", "every Monday": a recurring rule. */
  recurring: boolean;
  /** "questo mercoledì", "next Wednesday": one specific date. */
  specific: boolean;
}

export function findDays(t: string): DayMention | undefined {
  const out = new Set<number>();
  let recurring = false;
  const range = new RegExp(`(?:dal |da |from )?${DAY_TOKEN}\\s*(?:al |a |to |through |thru |-|–|—|/)\\s*${DAY_TOKEN}\\b`).exec(t);
  if (range) {
    dayRange(DAY_INDEX[range[1]], DAY_INDEX[range[2]]).forEach((d) => out.add(d));
    recurring = true;
  }
  const groups: [RegExp, number[]][] = [
    [/\bweekdays\b|giorni feriali|infrasettimanal|giorni lavorativi|\bferiali\b/, [1, 2, 3, 4, 5]],
    [/tutti i giorni|ogni giorno|every ?day|7 giorni su 7|seven days a week|7 days a week/, [0, 1, 2, 3, 4, 5, 6]],
    [/\bweekends?\b|fine settimana|fine-settimana/, [6, 0]],
  ];
  for (const [re, list] of groups) {
    if (!has(t, re)) continue;
    list.forEach((d) => out.add(d));
    recurring = true;
  }
  for (const [re, d] of DAY_WORDS) if (re.test(t)) out.add(d);
  if (!out.size) return undefined;
  const dayWord = '(?:domenica|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?)';
  if (new RegExp(`\\b(?:il|i|ogni|di|tutti i|on|every)\\s+${dayWord}`).test(t) || /\b(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/.test(t)) recurring = true;
  const specific = new RegExp(`\\b(?:questo|quest'|this|next|prossimo)\\s+${dayWord}|${dayWord}\\s+(?:prossimo|questo)\\b`).test(t);
  return { days: MON_FIRST.filter((d) => out.has(d)), recurring: recurring && !specific, specific };
}

/** Next date strictly after `today` that falls on `wd`. */
export function nextWeekday(today: ISODate, wd: number): ISODate {
  const diff = (wd - weekday(today) + 7) % 7 || 7;
  return shiftDate(today, diff);
}

// ——— Dates & scope ———

const MONTHS: [RegExp, number][] = [
  [/\bgennaio\b|\bjanuary\b/, 1],
  [/\bfebbraio\b|\bfebruary\b/, 2],
  [/\bmarzo\b|\bmarch\b/, 3],
  [/\baprile\b|\bapril\b/, 4],
  [/\bmaggio\b|\bmay\b(?! be)/, 5],
  [/\bgiugno\b|\bjune\b/, 6],
  [/\bluglio\b|\bjuly\b/, 7],
  [/\bagosto\b|\baugust\b/, 8],
  [/\bsettembre\b|\bseptember\b|\bsept\b/, 9],
  [/\bottobre\b|\boctober\b/, 10],
  [/\bnovembre\b|\bnovember\b/, 11],
  [/\bdicembre\b|\bdecember\b/, 12],
];

export type Scope = { kind: 'recurring'; from: ISODate } | { kind: 'dates'; from: ISODate; to: ISODate };

function isoOf(y: number, m: number, d: number): ISODate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** When a statement applies. Undefined = the player didn't say (the Coach may ask). */
export function findScope(t: string, today: ISODate, days?: DayMention): Scope | undefined {
  const [y, m] = today.split('-').map(Number);
  const from = String.raw`(?:da|dal|dalla|dall'|a partire da|starting|from|beginning|as of)\s+`;

  if (has(t, /d'ora in poi|da ora in poi|da adesso|da ora\b|from now on|going forward|d'ora in avanti/)) return { kind: 'recurring', from: today };
  if (new RegExp(`${from}(?:oggi|today)`).test(t)) return { kind: 'recurring', from: today };
  if (new RegExp(`${from}domani|${from}tomorrow`).test(t)) return { kind: 'recurring', from: shiftDate(today, 1) };
  if (new RegExp(`${from}(?:la )?(?:settimana prossima|prossima settimana|next week)`).test(t)) return { kind: 'recurring', from: nextWeekday(today, 1) };
  if (new RegExp(`${from}questa settimana|${from}this week`).test(t)) return { kind: 'recurring', from: today };

  // "da lunedì", "from Monday"
  const fromDay = new RegExp(`${from}${DAY_TOKEN}\\b(?!\\s*(?:al|a|to|-|–)\\s)`).exec(t);
  if (fromDay) return { kind: 'recurring', from: nextWeekday(today, DAY_INDEX[fromDay[1]]) };

  // "dal 5 ottobre", "from October 5", "da ottobre"
  for (const [re, month] of MONTHS) {
    if (!re.test(t)) continue;
    const num = new RegExp(`(\\d{1,2})\\s*(?:${re.source})|(?:${re.source})\\s*(\\d{1,2})\\b`).exec(t);
    const day = Math.min(31, num ? Number(num[1] ?? num[2]) : 1);
    const year = month < m || (month === m && num && day < Number(today.slice(8))) ? y + 1 : y;
    const date = month === m && !num ? today : isoOf(year, month, day);
    const ongoing = /\bda\b|\bdal\b|\bdall'|\bfrom\b|a partire|starting|\bin\b|\ba\b|\bby\b|\bdi\b/.test(t);
    return ongoing ? { kind: 'recurring', from: date } : { kind: 'dates', from: date, to: date };
  }

  if (has(t, /\bdopodomani\b|day after tomorrow/)) return { kind: 'dates', from: shiftDate(today, 2), to: shiftDate(today, 2) };
  if (has(t, /\bdomani\b|\btomorrow\b/)) return { kind: 'dates', from: shiftDate(today, 1), to: shiftDate(today, 1) };
  if (has(t, /\boggi\b|\btoday\b|\bstasera\b|\btonight\b|\bstamattina\b|this morning/)) return { kind: 'dates', from: today, to: today };
  if (has(t, /questa settimana|this week|per la settimana|settimana corrente/)) return { kind: 'dates', from: today, to: shiftDate(weekStart(today), 6) };
  if (has(t, /(?:la )?(?:settimana prossima|prossima settimana)|next week/)) {
    const mon = nextWeekday(today, 1);
    return { kind: 'dates', from: mon, to: shiftDate(mon, 6) };
  }
  if (days?.specific && days.days.length === 1) {
    const d = nextWeekday(shiftDate(today, -1), days.days[0]);
    return { kind: 'dates', from: d, to: d };
  }
  return undefined;
}

// ——— Times ———

const T = String.raw`(\d{1,2})(?:(?::|\.|h)(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;

function toHm(h: string, mm: string | undefined, ap: string | undefined): TimeHM | undefined {
  let hour = Number(h);
  const min = mm ? Number(mm) : 0;
  if (ap?.startsWith('p') && hour < 12) hour += 12;
  if (ap?.startsWith('a') && hour === 12) hour = 0;
  if (hour > 24 || min > 59) return undefined;
  return `${String(hour % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const minutesOf = (hm: TimeHM) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const plus12 = (hm: TimeHM) => `${String((Number(hm.slice(0, 2)) + 12) % 24).padStart(2, '0')}:${hm.slice(3)}`;

export interface TimeInfo {
  start?: TimeHM;
  end?: TimeHM;
  durationMin?: number;
  breakMin?: number;
  approximate: boolean;
  /** "Finisco prima" / "I finish earlier", with no time given. */
  earlier?: boolean;
  later?: boolean;
}

const APPROX = /\bprobabilmente\b|\bforse\b|\bcirca\b|piu o meno|\bverso\b|intorno alle|\bprobably\b|\bmaybe\b|\baround\b|\babout\b|\broughly\b|\bish\b|~|\bdovrei\b|\bshould\b|\bpenso\b|\bi think\b|\bcredo\b/;

export function findTimes(t: string): TimeInfo {
  const info: TimeInfo = { approximate: APPROX.test(t) };
  const range = new RegExp(String.raw`(?:dalle ore|dalle|dall'|dalla|da|from|tra le|fra le|between|alle)?\s*\b${T}\s*(?:alle|all'|fino alle|fino a|a|to|till|until|-|–|—|e le|and)\s*${T}(?!\s*(?:kg|cm|passi|steps|min|ore|hours|giorni|days|volte|times|x))`).exec(t);
  if (range) {
    const s = toHm(range[1], range[2], range[3]);
    let e = toHm(range[4], range[5], range[6]);
    if (s && e && minutesOf(e) <= minutesOf(s) && Number(range[4]) <= 12 && !range[6]) e = plus12(e);
    if (s && e) {
      info.start = s;
      info.end = e;
    }
  }
  if (!info.start) {
    const st = new RegExp(String.raw`(?:dalle ore|dalle|dall'|inizio alle|inizio a|inizio verso le|comincio alle|attacco alle|entro alle|entro verso le|parto alle|verso le|start(?:ing|s)? (?:at|around)|begin(?:s|ning)? at|from|(?:lavoro|lavorero|lavori|work) alle|at)\s*${T}`).exec(t);
    if (st && !/\b(?:finisco|stacco|esco|until|till|finish|end)\b[^.]{0,8}$/.test(t.slice(0, st.index))) {
      const v = toHm(st[1], st[2], st[3]);
      if (v) info.start = v;
    }
  }
  if (!info.end) {
    const en = new RegExp(String.raw`(?:finisco alle|finisco verso le|finisco a|finisco|stacco alle|stacco|esco alle|esco dal lavoro alle|fino alle|until|till|finish(?:es)?(?: work)? (?:at|around)|end(?:s)? at|get off at|leave work at|done at|off at)\s*${T}`).exec(t);
    if (en) {
      let v = toHm(en[1], en[2], en[3]);
      if (v && info.start && minutesOf(v) <= minutesOf(info.start) && Number(en[1]) <= 12 && !en[3]) v = plus12(v);
      else if (v && !info.start && Number(en[1]) < 8 && !en[3]) v = plus12(v);
      if (v) info.end = v;
    }
  }
  if (!info.end && has(t, /finisco prima|esco prima|stacco prima|finisco presto|esco presto|finish earl(?:y|ier)|leave earl(?:y|ier)|get off earl(?:y|ier)|short(?:er)? day/)) info.earlier = true;
  if (!info.start && has(t, /inizio (?:piu )?tardi|entro (?:piu )?tardi|comincio (?:piu )?tardi|start later|start late\b/)) info.later = true;

  const dur = /(?:lavoro|faccio|work|part.?time(?: di)?|per)\s+(\d+(?:[.,]\d+)?)\s*(?:ore|ora|h\b|hours?|hrs?)\b|(\d+(?:[.,]\d+)?)\s*(?:ore|hours?) (?:al giorno|a day|per day|di lavoro|of work)/.exec(t);
  if (dur) info.durationMin = Math.round(parseFloat((dur[1] ?? dur[2]).replace(',', '.')) * 60);

  const brk =
    /pausa(?: pranzo)?(?: di)? (\d+)\s*(min|minuti|ore|ora|h\b|hours?)/.exec(t) ??
    /(\d+)\s*(min|minuti|minutes?)\s*(?:di )?(?:pausa|break|lunch)/.exec(t) ??
    /(\d+|an?|one) (hours?|ora) (?:di pausa|(?:lunch )?break)/.exec(t);
  if (brk) {
    const n = /^\d+$/.test(brk[1]) ? Number(brk[1]) : 1;
    info.breakMin = /^(ore|ora|h|hours?)$/.test(brk[2]) ? n * 60 : n;
  } else if (has(t, /un'ora di pausa|un ora di pausa|an hour (?:lunch )?break|one hour (?:lunch )?break/)) info.breakMin = 60;
  else if (has(t, /mezz'ora di pausa|half an hour (?:lunch )?break|30 min(?:uti)? di pausa/)) info.breakMin = 30;
  return info;
}

/** A bare clock time anywhere after a keyword ("mi sveglio alle 7"). */
export function timeAfter(t: string, keyword: RegExp): TimeHM | undefined {
  const m = new RegExp(String.raw`(?:${keyword.source})[^\d]{0,24}?${T}`).exec(t);
  if (!m) return undefined;
  let v = toHm(m[1], m[2], m[3]);
  // "vado a letto alle 11" means 23:00
  if (v && keyword.source.includes('letto') && Number(m[1]) <= 3 && !m[3]) return v;
  if (v && /letto|bed|sleep|dorm/.test(keyword.source) && Number(m[1]) >= 7 && Number(m[1]) <= 12 && !m[3]) v = plus12(v);
  return v;
}

// ——— Numbers ———

export function findWeight(t: string): number | undefined {
  const m = /(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|chili|chilogrammi|kilos?)\b/.exec(t) ?? /(?:peso|weigh|pesavo|sono sui|i'm at)\s*(?:circa\s*)?(\d{2,3}(?:[.,]\d{1,2})?)/.exec(t);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(',', '.'));
  return v >= 30 && v <= 300 ? v : undefined;
}

export function findHeight(t: string): number | undefined {
  const cm = /(\d{3})\s*cm\b/.exec(t) ?? /(?:alto|altezza|tall|height|misuro)\s*(?:circa\s*)?(\d{3})\b/.exec(t);
  if (cm) {
    const v = Number(cm[1]);
    return v >= 120 && v <= 230 ? v : undefined;
  }
  const m = /(?:alto|altezza|tall|height|misuro)\s*(?:circa\s*)?(1[.,]\d{2})\s*(?:m|metri)?\b/.exec(t);
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) : undefined;
}

export function findSteps(t: string): number | undefined {
  const m = /(\d{1,2}(?:[.,]\d{3})|\d{3,5}|\d{1,2}(?:[.,]\d)?\s*k|\d{1,2}(?:[.,]\d)?\s*mila)\s*(?:passi|steps)/.exec(t);
  if (!m) return undefined;
  const raw = m[1].replace(/\s/g, '');
  const v = /k|mila/.test(raw) ? parseFloat(raw.replace(',', '.')) * 1000 : Number(raw.replace(/[.,]/g, ''));
  return v >= 500 && v <= 60000 ? Math.round(v) : undefined;
}

// ——— Goals ———

const GOAL_PATTERNS: [RegExp, string][] = [
  [/\bforza\b|\bforte\b|strength|stronger|\bpower\b/, 'strength'],
  [/dimagri|perdere peso|perdere grasso|\bdefini|fat loss|lose (?:weight|fat)|\bcut(?:ting)?\b|\bgrasso\b/, 'fat_loss'],
  [/\bmassa\b|muscol|\bbulk|\bmuscle|gain weight|mettere su/, 'muscle'],
  [/resistenz|\bcardio\b|\bcorsa\b|correre|endurance|\brun(?:ning)?\b|\bfiato\b/, 'endurance'],
  [/\broutine\b|abitudini|\bhabits?\b|costanza|consistency/, 'routine'],
  [/\bsonno\b|dormire meglio|\bsleep\b/, 'sleep'],
  [/alimentazione|mangiare meglio|\bdieta\b|nutrition|eat(?:ing)? better/, 'nutrition'],
  [/lettura|leggere|studiare|imparare|\blearn|\bread(?:ing)?\b|\bstudy/, 'learning'],
  [/\bordine\b|pulizi|casa in ordine|\btidy|\bclean(?:ing)?\b/, 'order'],
  [/\bstress\b|\bansia\b|\bmente\b|calma|\bcalm|\bmind\b|meditaz/, 'mind'],
  [/schermo|telefono|\bsocial\b|\bscreen\b|\bphone\b|tiktok/, 'screen'],
  [/nofap|\bporno?\b|masturbaz/, 'nofap'],
];

export function findGoals(t: string): string[] {
  return GOAL_PATTERNS.filter(([re]) => re.test(t)).map(([, g]) => g);
}

// ——— Work clauses ———

export interface WorkClause {
  days?: number[];
  times: TimeInfo;
}

const FROM_DAY = new RegExp(`(?:da|dal|dalla|a partire da|starting|from)\\s+${DAY_TOKEN}\\b(?!\\s*(?:al|a|to|-|–)\\s)`, 'g');

/** Days mentioned as *working days* (a "da lunedì" start date is not a working-day list). */
export function workDays(t: string): DayMention | undefined {
  return findDays(t.replace(FROM_DAY, ' ').replace(/(?:tranne|except|eccetto|but not)\s+(?:il |i |la |on )?\S+/g, ' '));
}

/** "8–18 Mon–Fri, Wednesday until 14" → one clause per group of days. */
export function workClauses(t: string): WorkClause[] {
  const parts = t.split(/[,;]|\bma\b|\bbut\b|\bmentre\b|\be il\b|\band on\b|\be di\b/).map((x) => x.trim()).filter(Boolean);
  const out: WorkClause[] = [];
  for (const p of parts) {
    const days = workDays(p);
    const times = findTimes(p);
    if (!days && !times.start && !times.end && !times.durationMin && !times.earlier && !times.later) continue;
    out.push({ days: days?.days, times });
  }
  return out;
}

export function offDays(t: string): number[] {
  const m = new RegExp(`(?:tranne|except|eccetto|but not|apart from)\\s+(?:il |i |la |on |the )?${DAY_TOKEN}`, 'g');
  const out: number[] = [];
  for (const x of t.matchAll(m)) out.push(DAY_INDEX[x[1]]);
  return out;
}

// ——— Intents ———

export type Intent =
  | { type: 'work_unknown' }
  | { type: 'work_none'; scope?: Scope }
  | { type: 'work_started' }
  | { type: 'work_hours'; scope?: Scope; days?: DayMention; times: TimeInfo; variable?: boolean; clauses: WorkClause[]; offDays: number[]; future: boolean }
  | { type: 'day_off'; scope?: Scope; days?: DayMention }
  | { type: 'no_gym'; scope?: Scope }
  | { type: 'training_days'; days: number[] | 'unknown' }
  | { type: 'time_budget'; direction: 'more' | 'less'; scope?: Scope }
  | { type: 'load_mode'; mode: 'push' | 'keep_all' | 'light'; scope?: Scope }
  | { type: 'leave_as_is' }
  | { type: 'goals'; goals: string[]; changedOnly: boolean }
  | { type: 'wake'; time?: TimeHM }
  | { type: 'sleep'; time?: TimeHM }
  | { type: 'weight'; kg: number }
  | { type: 'height'; cm: number }
  | { type: 'steps'; value?: number }
  | { type: 'plan_day' }
  | { type: 'keep_quest'; query: string }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'greeting' }
  | { type: 'thanks' }
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'not_sure' };

const WORK = /\blavor|\bwork(?:ing|s)?\b|\bjob\b|\bturn[oi]\b|\bshifts?\b|\bufficio\b|\boffice\b|\borari/;
const GYM = /palestra|\bgym\b|allenar|allenament|\bworkouts?\b|\btrain(?:ing)?\b|\bpesi\b/;
const NEG = /\bnon\b|\bno\b|\bniente\b|\bnessun|\bcan't\b|\bcannot\b|\bcan not\b|\bwon't\b|\bnot\b|\bskip\b/;
const NOT_SURE = /\bnon (?:lo )?so\b|non sono sicur|\bboh\b|\bnot sure\b|\bdunno\b|\bdon'?t know\b|\bno idea\b|\bnon ancora\b|\bnot yet\b|ancora non/;

export function parseMessage(raw: string, today: ISODate): Intent[] {
  const t = normalize(raw);
  const out: Intent[] = [];
  if (!t) return out;
  const words = t.split(' ').length;

  // Short answers
  if (words <= 3) {
    if (/^(si|yes|yep|yeah|ok|okay|certo|va bene|sure|esatto|giusto|confermo|apply|applica|vai)\b/.test(t)) return [{ type: 'yes' }];
    if (/^(no|nope|nah|annulla|cancel|lascia stare|non mi va|non voglio|i don'?t want)\b/.test(t)) return [{ type: 'no' }];
    if (NOT_SURE.test(t)) return [{ type: 'not_sure' }];
  }
  if (/^(ciao|hey|hi|hello|buongiorno|buonasera|salve|yo)\b/.test(t) && words <= 4) out.push({ type: 'greeting' });
  if (/\bgrazie\b|\bthanks?\b|thank you/.test(t) && words <= 5) out.push({ type: 'thanks' });
  if (/\baiuto\b|\bhelp\b|cosa puoi fare|what can you do|come funzion|how does this work/.test(t)) out.push({ type: 'help' });
  if (/cosa sai di me|what do you know|il mio profilo|my profile|riepilogo|summary of me|le mie info/.test(t)) out.push({ type: 'status' });
  if (/lascia(?: tutto)? (?:com'e|come e|cosi|stare)|leave (?:it|everything) (?:as is|alone)|keep it as is|non cambiare|don'?t change|va bene cosi/.test(t)) out.push({ type: 'leave_as_is' });
  if (/organizz|pianific|plan (?:my|the) day|piano (?:di|per) oggi|cosa (?:devo )?fa(?:re|ccio) oggi|what should i do today|plan today/.test(t)) out.push({ type: 'plan_day' });

  const keep = /(?:voglio (?:comunque|lo stesso|ancora) fare|voglio fare comunque|tieni|keep|i still want to do|non togliere)\s+(?:la quest |il |la |lo |l')?(.+)/.exec(t);
  if (keep && !/\btutto\b|\beverything\b|\btutte\b|\ball\b/.test(keep[1])) out.push({ type: 'keep_quest', query: keep[1] });

  // Load mode
  if (/spinger|\bpush\b|dammi di piu|more quests|go hard|hardcore|voglio di piu|piu quest|alza il livello/.test(t)) out.push({ type: 'load_mode', mode: 'push', scope: findScope(t, today) });
  else if (/non ridurre|don'?t reduce|do not reduce|non togliere nulla|keep everything|tieni tutto|voglio fare tutto|non alleggerire|don'?t lighten/.test(t)) out.push({ type: 'load_mode', mode: 'keep_all', scope: findScope(t, today) });
  else if (/alleggeris|piu legger|giornata legger|lighter|easier day|take it easy|piano piano|sono stanc|i'?m tired|sono distrutt/.test(t) && !WORK.test(t)) out.push({ type: 'load_mode', mode: 'light', scope: findScope(t, today) ?? { kind: 'dates', from: today, to: today } });

  // Time budget
  const more = /(?:avro|ho|avere|avremo|have|will have|i'll have|got)\s+(?:molto |un po' di |a bit |a lot |much )?piu tempo|more (?:free )?time|piu liber|meno impegnat|less busy/.test(t);
  const less = /(?:avro|ho|avere|have|will have|i'll have)\s+(?:molto |un po' )?meno tempo|less (?:free )?time|piu impegnat|busier|more busy|sono pieno|incasinat/.test(t);
  if (more || less) out.push({ type: 'time_budget', direction: more ? 'more' : 'less', scope: findScope(t, today) });

  // Gym
  if (GYM.test(t) && NEG.test(t) && /posso|riesco|vado|andare|niente|salto|can|able|going|skip|no gym|without/.test(t)) {
    out.push({ type: 'no_gym', scope: findScope(t, today) });
  } else if (GYM.test(t) && /posso|riesco|disponibil|can|available/.test(t) && !NEG.test(t)) {
    const d = findDays(t);
    if (d) out.push({ type: 'training_days', days: d.days });
  } else if (GYM.test(t) && NOT_SURE.test(t)) out.push({ type: 'training_days', days: 'unknown' });

  // Work
  const DAY_OFF = /\bnon lavoro\b|\bnon lavorero\b|\bday off\b|\bgiorno libero\b|\bgiornata libera\b|\bsono libero\b|\bsono a casa\b|\bferie\b|\bvacation\b|\bholiday\b|\bi'?m off\b|\bi am off\b|\bnot working\b|\bdon'?t work\b|\bi'?m not working\b|\bi am not working\b/;
  if (WORK.test(t) || DAY_OFF.test(t) || /\bfinisco\b|\bstacco\b|\bentro alle\b|\bfinish\b|\bget off\b/.test(t)) {
    const days = workDays(t);
    const scope = findScope(t, today, days);
    const times = findTimes(t);
    const hasTimes = !!(times.start || times.end || times.durationMin || times.earlier || times.later);
    const variable = /a turni|turni variabili|orari variabili|cambiano ogni|variable hours|shifts? (?:vary|change)|hours (?:vary|change)|rotating shifts/.test(t);
    if (NOT_SURE.test(t) && !hasTimes) out.push({ type: 'work_unknown' });
    else if (DAY_OFF.test(t) && !hasTimes) {
      if (scope || days) out.push({ type: 'day_off', scope, days });
      else out.push({ type: 'work_none' });
    } else if (/disoccupat|unemployed|non ho (?:un )?lavoro|no job|senza lavoro|ho perso il lavoro|lost my job|ho lasciato il lavoro|quit my job/.test(t)) out.push({ type: 'work_none', scope });
    else if (hasTimes || variable || (days && !/\bnon\b|\bnot\b/.test(t))) {
      const future = /lavorero|lavorer|will work|i'?ll work|i'?m going to work|iniziero|comincero|iniziato a lavorare|trovato (?:un )?lavoro|nuovo lavoro|new job|started (?:a )?(?:new )?(?:job|working)/.test(t);
      out.push({ type: 'work_hours', scope, days, times, variable, clauses: workClauses(t), offDays: offDays(t), future });
    }
    else if (/iniziato a lavorare|trovato (?:un )?lavoro|nuovo lavoro|started (?:a )?(?:new )?(?:job|working)|new job|got a job|comincio a lavorare|inizio a lavorare|iniziero a lavorare/.test(t)) out.push({ type: 'work_started' });
  }

  // Goals
  if (/obiettiv|\bgoals?\b|concentrar|\bfocus|puntare su|priorita|voglio (?:diventare|migliorare)|mi interessa di piu/.test(t)) {
    const goals = findGoals(t);
    out.push({ type: 'goals', goals, changedOnly: goals.length === 0 });
  }

  // Rhythm
  if (/sveglio|sveglia|mi alzo|wake up|get up|wake at|woke/.test(t)) {
    const time = timeAfter(t, /sveglio|sveglia|mi alzo|wake up|get up|wake at/);
    out.push({ type: 'wake', time: NOT_SURE.test(t) ? undefined : time });
  }
  if (/a letto|vado a dormire|dormo alle|bedtime|go to bed|go to sleep|sleep at|mi corico/.test(t)) {
    const time = timeAfter(t, /a letto|vado a dormire|dormo alle|bedtime|go to bed|go to sleep|sleep at|mi corico/);
    out.push({ type: 'sleep', time: NOT_SURE.test(t) ? undefined : time });
  }

  // Body & steps
  const kg = findWeight(t);
  if (kg && /peso|weigh|kg|chili|kilos/.test(t) && !GYM.test(t.replace(/palestra/, ''))) out.push({ type: 'weight', kg });
  const cm = findHeight(t);
  if (cm) out.push({ type: 'height', cm });
  if (/\bpassi\b|\bsteps\b/.test(t)) out.push({ type: 'steps', value: NOT_SURE.test(t) ? undefined : findSteps(t) });

  if (!out.length && NOT_SURE.test(t)) out.push({ type: 'not_sure' });
  return out;
}
