/**
 * Optional Claude connection, used only when the player adds their own API key.
 * The key is stored in this browser's localStorage (never in settings or backups)
 * and requests go straight from the device to the Anthropic API.
 */

const API = 'https://api.anthropic.com/v1';
const KEY_STORAGE = 'lf-ai-key';

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable
  }
}

function headers(key: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export class AiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // ignore
  }
  const reason = res.status === 401 ? 'The API key was rejected.' : res.status === 429 ? 'Rate limited — try again in a moment.' : `Request failed (${res.status}).`;
  throw new AiError(detail ? `${reason} ${detail}` : reason, res.status);
}

export interface AiModel {
  id: string;
  name: string;
}

/** Models available to this key, newest first (lets the player pick without us hard-coding ids). */
export async function listModels(key = getApiKey()): Promise<AiModel[]> {
  if (!key) throw new AiError('Add an API key first.');
  const res = await check(await fetch(`${API}/models?limit=50`, { headers: headers(key) }));
  const body = (await res.json()) as { data?: { id: string; display_name?: string }[] };
  return (body.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
}

/** Pick a sensible default: the newest general-purpose model the key can use. */
export function defaultModel(models: AiModel[]): string {
  return (models.find((m) => /sonnet/i.test(m.id)) ?? models[0])?.id ?? '';
}

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** One forced tool call: the model must answer with structured input for `tool`. */
export async function callTool<T>(opts: { model: string; system: string; content: ContentBlock[]; tool: ToolSpec; maxTokens?: number; key?: string; signal?: AbortSignal }): Promise<T> {
  const key = opts.key ?? getApiKey();
  if (!key) throw new AiError('Add an API key in Settings → Coach first.');
  if (!opts.model) throw new AiError('Choose a model in Settings → Coach first.');
  const res = await check(
    await fetch(`${API}/messages`, {
      method: 'POST',
      headers: headers(key),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: 'user', content: opts.content }],
        tools: [opts.tool],
        tool_choice: { type: 'tool', name: opts.tool.name },
      }),
    }),
  );
  const body = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const use = body.content?.find((c) => c.type === 'tool_use' && c.name === opts.tool.name);
  if (!use) throw new AiError('The model did not return a structured answer.');
  return use.input as T;
}

export function aiReady(enabled: boolean, model: string): boolean {
  return enabled && !!model && !!getApiKey();
}
