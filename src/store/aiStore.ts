import { create } from 'zustand';
import type { ModelsResponse } from '@/ai/shared/models';
import { EMPTY_STATS, modelUsage, type ModelUsage, type RouterStats } from '@/domain/aiRouter';
import type { UsageSummary } from '@/domain/aiUsage';
import { geminiProvider, type StatusResponse } from '@/services/ai/gemini';
import { getRouterStats, onRouterChange } from '@/services/ai/routerState';
import { getUsageSummary, onUsageChange, usageRecords } from '@/services/ai/usageService';

/** Wizard/status states shown in Settings → AI. */
export type AiUiState = 'not_connected' | 'connecting' | 'connected' | 'error' | 'quota' | 'invalid_key' | 'server_error' | 'offline';

interface AiStore {
  status?: StatusResponse;
  ui: AiUiState;
  checkedAt?: number;
  usage?: UsageSummary;
  /** Models discovered by the server router (capabilities, Free Tier status, routes). */
  models?: ModelsResponse;
  modelsLoading: boolean;
  /** Local router memory: current/last model, fallbacks, cooldowns, learned limits. */
  router: RouterStats;
  /** Per-model usage from this device's request log (app estimate). */
  perModel: Record<string, ModelUsage>;
  refreshModels(refresh?: boolean): Promise<void>;
  /** Check the connection. `test` sends one tiny real request (Test connection button). */
  check(opts?: { test?: boolean; force?: boolean }): Promise<StatusResponse | undefined>;
  refreshUsage(): Promise<void>;
  /** Mark the state from a failed request without an extra status call. */
  noteError(kind: string): void;
}

export function uiState(s?: StatusResponse): AiUiState {
  switch (s?.state) {
    case undefined:
      return 'not_connected';
    case 'connected':
      return 'connected';
    case 'not_configured':
      return 'not_connected';
    case 'quota':
      return 'quota';
    case 'invalid_key':
      return 'invalid_key';
    case 'offline':
      return 'offline';
    case 'server':
      return 'server_error';
    case 'no_model':
    case 'cost_blocked':
      return 'error';
    default:
      return 'error';
  }
}

const TTL = 10 * 60_000;
let pending: Promise<StatusResponse | undefined> | undefined;

export const useAi = create<AiStore>((set, get) => ({
  ui: 'not_connected',
  modelsLoading: false,
  router: EMPTY_STATS,
  perModel: {},
  async refreshModels(refresh = false) {
    set({ modelsLoading: true });
    try {
      const models = await geminiProvider.models(refresh);
      if (models) set({ models });
    } finally {
      set({ modelsLoading: false });
    }
  },
  async check(opts = {}) {
    const fresh = get().checkedAt && Date.now() - get().checkedAt! < TTL;
    if (!opts.test && !opts.force && fresh) return get().status;
    if (pending && !opts.test) return pending;
    set({ ui: 'connecting' });
    pending = geminiProvider
      .status(!!opts.test)
      .then((status) => {
        set({ status, ui: uiState(status), checkedAt: Date.now() });
        return status;
      })
      .catch(() => {
        set({ ui: 'error', checkedAt: Date.now() });
        return undefined;
      })
      .finally(() => {
        pending = undefined;
        void get().refreshUsage();
      });
    return pending;
  },
  async refreshUsage() {
    const [usage, router, records] = await Promise.all([getUsageSummary(), getRouterStats(), usageRecords()]);
    set({ usage, router, perModel: modelUsage(records) });
  },
  noteError(kind) {
    const status = get().status;
    const map: Record<string, AiUiState> = { quota: 'quota', invalid_key: 'invalid_key', server: 'server_error', offline: 'offline', not_configured: 'not_connected', model: 'error' };
    if (map[kind]) set({ ui: map[kind], status: status ? { ...status, state: kind === 'server' ? 'server' : (kind as StatusResponse['state']) } : status });
  },
}));

onUsageChange(() => void useAi.getState().refreshUsage());
onRouterChange(() => void useAi.getState().refreshUsage());

/** Gemini can be used right now (connected and enabled in settings). */
export function geminiReady(enabled: boolean): boolean {
  return enabled && useAi.getState().ui === 'connected';
}
