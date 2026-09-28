import { normalize } from './nlu';

/**
 * Deterministic Coach commands answered on the device from real data (no AI request):
 * "What should I do right now?", "Plan my evening", "Prepare tomorrow"… Italian and English.
 * Conservative: anything that is not clearly one of these goes to the normal parser / Gemini.
 */

export type CoachCommand = 'right_now' | 'time_left' | 'plan_evening' | 'prepare_tomorrow' | 'postponed' | 'bad_day';

const PATTERNS: [CoachCommand, RegExp][] = [
  ['bad_day', /\b(bad|rough|terrible|awful|horrible|shit|crap) day\b|recover from (a|my|this) (bad|rough) day|giornata (storta|no|pessima|orribile|di merda|difficile)|brutta giornata|oggi (e|è) andata (male|malissimo)|riprendermi da/],
  ['postponed', /\b(what|show|list)\b.*\b(postponed|snoozed|put off|rescheduled|deferred)\b|\b(postponed|snoozed) (quests?|tasks?|things?)\b|(cosa|mostrami|fammi vedere).*(rimandat|posticipat|spostat)|\b(quest|cose|attivita) rimandat/],
  ['prepare_tomorrow', /\bprepare (for )?tomorrow\b|\bplan (for )?tomorrow\b|\btomorrow'?s plan\b|what(?:'s| is) (on )?tomorrow\b|prepara(re)? (il )?domani|organizza(re)? (il )?domani|cosa (ho|mi aspetta) domani|piano (di|per) domani/],
  ['plan_evening', /\bplan (my|the|this) (evening|night)\b|\b(my|this) evening plan\b|what (should|can) i do (this|tonight|in the) ?(evening|tonight)?\b.*\b(evening|tonight)\b|organizza(re)? (la |questa )?(mia )?serata|piano (per|della) (la )?serata|cosa faccio stasera/],
  ['time_left', /how much (free )?time (do i (actually |really )?have|is left|have i got)|how much time.*today|quanto tempo (libero )?(ho|mi resta|mi rimane)|quanto tempo.*oggi|tempo (libero )?(che )?mi resta/],
  ['right_now', /what should i do (right )?now|what (do|can) i do (right )?now|what'?s next\??$|what now\??$|cosa (dovrei fare|devo fare|faccio|posso fare) (ora|adesso|in questo momento)|cosa faccio\??$|e adesso\??$/],
];

export function coachCommand(raw: string): CoachCommand | undefined {
  const t = normalize(raw);
  if (t.length > 160) return undefined;
  return PATTERNS.find(([, re]) => re.test(t))?.[0];
}

export type MemoryIntent = { kind: 'remember'; text: string } | { kind: 'recall' } | { kind: 'forget'; query: string };

/** "Remember that I hate running" · "Ricorda che il martedì vado a calcetto" · "What do you remember about me?" · "Forget the running note". */
export function memoryIntent(raw: string): MemoryIntent | undefined {
  const trimmed = raw.trim();
  const t = normalize(trimmed);
  if (/^(what do you remember|what have you remembered|show (me )?(your|the) memory|cosa ricordi|cosa ti ricordi( di me)?|mostrami la (tua )?memoria)\b/.test(t)) return { kind: 'recall' };
  const forget = /^(?:please |per favore )?(?:forget|dimentica)(?: that| che| la nota| the note(?: about)?| about)?\s+(.{2,80})$/i.exec(trimmed);
  if (forget) return { kind: 'forget', query: forget[1].replace(/[.!?]+$/, '').trim() };
  const remember = /^(?:please |per favore )?(?:remember|ricorda(?:ti)?|tieni a mente|keep in mind)(?: that| che)?[:,]?\s+(.{3,})$/i.exec(trimmed);
  if (remember) {
    const text = remember[1].replace(/\s+/g, ' ').trim();
    // "Remind me to…" is a reminder, not a memory; "remember to" is a to-do phrasing.
    if (/^(to|di)\b/i.test(text) && !/che|that/i.test(trimmed.slice(0, 20))) return undefined;
    return { kind: 'remember', text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  return undefined;
}
