import type { RequestType } from './models.js';

/**
 * Classify a Coach message (Italian + English) so the router can pick a fast model
 * for quick questions and a more capable one for planning/analysis. Cheap keyword
 * heuristics on purpose: no AI call is spent on deciding which AI to call.
 */
export function classifyCoachText(raw: string): Extract<RequestType, 'TEXT_CHAT' | 'SIMPLE_COMMAND' | 'TOOL_EXECUTION' | 'PLANNING' | 'DATA_ANALYSIS'> {
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\b(organizza\w*|pianific\w*|programm\w*|settimana|week|weekly|mese|month|piano|plan|schedule|routine completa|ristruttura|restructure)\b/.test(t) && t.length > 18) return 'PLANNING';
  if (/\b(analizz\w*|analy[sz]\w*|andamento|progress\w*|trend|statistic\w*|confront\w*|compar\w*|perche|why|valuta|review|risultati|results|in base ai|based on)\b/.test(t)) return 'DATA_ANALYSIS';
  if (/\b(modific\w*|cambia\w*|change|update|aggiorn\w*|sposta|move|crea|create|aggiungi|add|elimina|delete|rimuovi|remove|imposta|set|porta|portare|metti|aumenta|increase|riduci|reduce|abbassa|lower|segna|mark|complet\w*|salta|skip|ricordami|remind)\b/.test(t)) return t.split(/\s+/).length <= 8 ? 'SIMPLE_COMMAND' : 'TOOL_EXECUTION';
  return 'TEXT_CHAT';
}
