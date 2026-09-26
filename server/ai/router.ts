import { ROUTES, type HealthStatus, type LimitValue, type ModelHint, type ModelLimits, type RequestType, type RoutingAttempt } from '../../src/ai/shared/models.js';
import { nextPacificMidnight } from '../../src/ai/shared/time.js';
import type { RegistryModel } from './registry.js';

/**
 * Model Router: picks the best available model for a request.
 *
 *   classify → capability filter → cost guard → availability (cooldowns, RPD/RPM/TPM)
 *   → score (route preference, version, stability, load, recent errors) → ordered chain
 *
 * Not round robin: the same healthy model keeps answering until something (a limit,
 * an error, a better fit) says otherwise. Fallbacks keep every required capability.
 */

// ——— Health (per serverless instance, merged with what the app reports) ———

export interface Health {
  status: HealthStatus;
  cooldownUntil?: number;
  lastError?: string;
  lastSuccess?: number;
  lastRateLimit?: number;
  consecutiveFailures: number;
  /** Limits Google reported in 429 details (authoritative). */
  learned: ModelLimits;
  /** Google reported a quota of 0: the model is not available on this project's tier. */
  notOnTier?: boolean;
}

const health = new Map<string, Health>();

export function getHealth(id: string): Health {
  let h = health.get(id);
  if (!h) {
    h = { status: 'UNKNOWN', consecutiveFailures: 0, learned: {} };
    health.set(id, h);
  }
  return h;
}

export function resetHealth(): void {
  health.clear();
}

export { nextPacificMidnight };

/** Update a model's health after an attempt; returns the cooldown applied (if any). */
export function recordOutcome(id: string, a: RoutingAttempt, now: number): number | undefined {
  const h = getHealth(id);
  if (a.outcome === 'ok') {
    Object.assign(h, { status: 'AVAILABLE', cooldownUntil: undefined, lastSuccess: now, consecutiveFailures: 0, lastError: undefined });
    return undefined;
  }
  h.consecutiveFailures += 1;
  let until: number | undefined;
  switch (a.outcome) {
    case 'rate_limited':
    case 'quota_exhausted': {
      h.lastRateLimit = now;
      const q = a.quota ?? {};
      if (q.quotaValue && q.quotaValue > 0 && (q.limitType === 'rpm' || q.limitType === 'tpm' || q.limitType === 'rpd')) h.learned[q.limitType] = q.quotaValue;
      if (q.quotaValue === 0) {
        h.notOnTier = true;
        h.status = 'UNSUPPORTED';
        until = now + 24 * 3_600_000;
      } else if (q.limitType === 'rpd' || q.limitType === 'tpd') {
        h.status = 'QUOTA_EXHAUSTED';
        until = nextPacificMidnight(now);
      } else {
        h.status = 'RATE_LIMITED';
        const base = q.retryAfterSec !== undefined ? q.retryAfterSec * 1000 : 60_000;
        until = now + Math.min(15 * 60_000, q.retryAfterSec !== undefined ? base : base * 2 ** Math.max(0, h.consecutiveFailures - 1));
      }
      h.lastError = `429 ${q.limitType ?? 'rate limit'}`;
      break;
    }
    case 'unavailable':
      h.status = 'UNSUPPORTED';
      h.lastError = 'Model not available';
      until = now + 60 * 60_000;
      break;
    case 'unsupported':
      h.status = 'UNSUPPORTED';
      h.lastError = 'Feature not supported by this model';
      until = now + 60 * 60_000;
      break;
    case 'transient':
      h.status = 'BUSY';
      h.lastError = `Temporary error${a.status ? ` (${a.status})` : ''}`;
      until = now + Math.min(5 * 60_000, 10_000 * 2 ** Math.max(0, h.consecutiveFailures - 1));
      break;
    default:
      h.status = 'ERROR';
      h.lastError = `Error${a.status ? ` (${a.status})` : ''}`;
      until = now + 30_000;
  }
  h.cooldownUntil = Math.max(h.cooldownUntil ?? 0, until);
  return h.cooldownUntil;
}

// ——— Selection ———

export interface SelectInput {
  requestType: RequestType;
  models: RegistryModel[];
  freeTierOnly: boolean;
  /** Server-side switch: paid models can only ever be used when GEMINI_ALLOW_PAID=true. */
  allowPaid: boolean;
  /** GEMINI_MODEL: preferred first choice when eligible. */
  preferred?: string;
  /** Model that produced the previous step of this turn. */
  sticky?: string;
  hints?: Record<string, ModelHint>;
  /** Rough size of this request in tokens (for TPM checks). */
  estimatedTokens?: number;
  now: number;
}

export interface Selection {
  chain: RegistryModel[];
  reasons: Record<string, string>;
  excluded: { id: string; why: string }[];
  /** Best model ignoring health — used to explain a fallback. */
  natural?: string;
  /** No eligible model at all because of the cost guard (vs. all busy/unavailable). */
  blockedByCost: boolean;
}

const limitNum = (v?: LimitValue): number | undefined => (typeof v === 'number' ? v : undefined);

/** Why a model can't serve this route at all (capabilities / cost), independent of health. */
export function staticExclusion(m: RegistryModel, requestType: RequestType, freeTierOnly: boolean, allowPaid: boolean): string | undefined {
  if (m.excluded) return m.excluded;
  const spec = ROUTES[requestType];
  if (!spec.prefer.includes(m.tier)) return `Not a ${spec.prefer.join('/')} model`;
  if (!m.capabilitiesKnown) return 'Capabilities unknown';
  const missing = spec.requires.filter((c) => m.capabilities[c] !== true);
  if (missing.length) return `Missing: ${missing.join(', ')}`;
  const guard = costGuard(m, freeTierOnly, allowPaid);
  if (!guard.ok) return guard.reason;
  return undefined;
}

/**
 * Cost Guard: the last check before any request. In FREE TIER ONLY mode only models
 * verified as Free Tier pass. Outside it, paid/unknown models additionally need the
 * server-side GEMINI_ALLOW_PAID=true — the app alone can never enable spending.
 */
export function costGuard(m: Pick<RegistryModel, 'freeTier' | 'id'>, freeTierOnly: boolean, allowPaid: boolean): { ok: true } | { ok: false; reason: string } {
  const h = health.get(m.id);
  if (h?.notOnTier && (freeTierOnly || !allowPaid)) return { ok: false, reason: 'Google reported no Free Tier quota for this model on your project' };
  if (m.freeTier === 'free') return { ok: true };
  if (freeTierOnly || !allowPaid) return { ok: false, reason: 'This model cannot be verified as Free Tier.' };
  return { ok: true };
}

function availability(m: RegistryModel, input: SelectInput): { skip?: string; penalty: number; note?: string } {
  const h = health.get(m.id);
  const hint = input.hints?.[m.id];
  const cooldown = Math.max(h?.cooldownUntil ?? 0, hint?.cooldownUntil ?? 0);
  if (cooldown > input.now) {
    const st = h && h.cooldownUntil === cooldown ? h.status : (hint?.status ?? 'RATE_LIMITED');
    return { skip: `${st === 'QUOTA_EXHAUSTED' ? 'Daily limit reached' : st === 'UNSUPPORTED' ? 'Unavailable' : 'Cooling down'} (~${Math.ceil((cooldown - input.now) / 1000)} s)`, penalty: 0 };
  }
  // Known limits: Google's (authoritative) first, then the player's entries from AI Studio.
  const limits: ModelLimits = { ...(hint?.limits ?? {}), ...(h?.learned ?? {}) };
  let penalty = 0;
  let note: string | undefined;
  const check = (used: number | undefined, limit: LimitValue | undefined, label: string, hard: string) => {
    const n = limitNum(limit);
    if (used === undefined || n === undefined) return undefined;
    if (used >= n) return `${hard} (${used}/${n})`;
    const r = used / n;
    if (r >= 0.9) {
      penalty += 400;
      note = `Near estimated ${label} limit`;
    } else if (r >= 0.7) {
      penalty += 120;
      note = `High estimated ${label} usage`;
    }
    return undefined;
  };
  const rpd = check(hint?.dayRequests, limits.rpd, 'RPD', 'Estimated daily limit reached');
  if (rpd) return { skip: rpd, penalty };
  const rpm = check(hint?.minuteRequests !== undefined ? hint.minuteRequests + 1 : undefined, limits.rpm, 'RPM', 'At estimated RPM limit');
  if (rpm) return { skip: rpm, penalty };
  const tpm = check(hint?.minuteTokens !== undefined ? hint.minuteTokens + (input.estimatedTokens ?? 0) : undefined, limits.tpm, 'TPM', 'At estimated TPM limit');
  if (tpm) return { skip: tpm, penalty };
  // Gentle spreading only (never aggressive rotation): a few points per recent request/error.
  penalty += Math.min(40, (hint?.minuteRequests ?? 0) * 4) + Math.min(150, (hint?.recentErrors ?? 0) * 50) + (h?.status === 'BUSY' || h?.status === 'ERROR' ? 60 : 0);
  return { penalty, note };
}

function baseScore(m: RegistryModel, input: SelectInput): number {
  const pref = ROUTES[input.requestType].prefer.indexOf(m.tier);
  let s = pref * 100 - Math.min(m.familyVersion, 20) * 8;
  if (m.preview) s += 25;
  if (m.alias) s += 35; // concrete versions first: an alias shares its target's quota
  if (input.preferred && m.id === input.preferred) s -= 1000;
  return s;
}

export function selectModels(input: SelectInput): Selection {
  const excluded: { id: string; why: string }[] = [];
  const reasons: Record<string, string> = {};
  const eligible: RegistryModel[] = [];
  let costBlocked = 0;
  for (const m of input.models) {
    const why = staticExclusion(m, input.requestType, input.freeTierOnly, input.allowPaid);
    if (why) {
      if (why === 'This model cannot be verified as Free Tier.' || why.startsWith('Google reported no Free Tier')) costBlocked += 1;
      excluded.push({ id: m.id, why });
    } else eligible.push(m);
  }
  const natural = [...eligible].sort((a, b) => baseScore(a, input) - baseScore(b, input))[0];
  const scored: { m: RegistryModel; score: number; note?: string }[] = [];
  for (const m of eligible) {
    const a = availability(m, input);
    if (a.skip) {
      excluded.push({ id: m.id, why: a.skip });
      continue;
    }
    let score = baseScore(m, input) + a.penalty;
    if (input.sticky && m.id === input.sticky) score -= 500;
    scored.push({ m, score, note: a.note });
  }
  scored.sort((a, b) => a.score - b.score || a.m.id.localeCompare(b.m.id));
  const chain = scored.map((s) => s.m);
  const first = scored[0];
  if (first) {
    const skippedNatural = natural && natural.id !== first.m.id ? excluded.find((e) => e.id === natural.id) : undefined;
    const naturalNote = natural && natural.id !== first.m.id ? scored.find((s) => s.m.id === natural.id)?.note : undefined;
    reasons[first.m.id] =
      input.preferred === first.m.id
        ? 'Preferred model (GEMINI_MODEL)'
        : input.sticky === first.m.id
          ? 'Continuing with the model used earlier in this conversation turn'
          : skippedNatural
            ? `${natural!.id}: ${skippedNatural.why.toLowerCase()} — switched to fallback`
            : naturalNote
              ? `${natural!.id}: ${naturalNote.toLowerCase()} — using a less-loaded model`
              : 'Best compatible available model';
  }
  for (const s of scored.slice(1)) reasons[s.m.id] = 'Fallback: compatible with this request';
  return { chain, reasons, excluded, natural: natural?.id, blockedByCost: !eligible.length && costBlocked > 0 };
}

/** Which routes a model could serve right now (for the settings screen). */
export function routesFor(m: RegistryModel, freeTierOnly: boolean, allowPaid: boolean): RequestType[] {
  return (Object.keys(ROUTES) as RequestType[]).filter((r) => !staticExclusion(m, r, freeTierOnly, allowPaid));
}
