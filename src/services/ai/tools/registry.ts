import { TOOL_BY_NAME, TOOL_DEFS, type Permission } from '@/ai/shared/tools';
import type { GameEvent } from '../../events';
import { logChange, recordChanges } from '../changeLog';
import { READ_TOOLS, readContext, ToolError } from './readTools';
import { WRITE_TOOLS, type Plan, type PreviewLine } from './writeTools';

/**
 * The single entry point for tool calls (from Gemini or from the rule-based coach):
 * validate → preview → (user confirmation, done by the UI) → execute → structured result.
 */

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** What the model receives back. `success` is the only thing that allows it to claim a change. */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  changeId?: string;
  undoable?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface PreparedAction {
  call: ToolCall;
  permission: Permission;
  title: string;
  lines: PreviewLine[];
  warnings: string[];
  confirmPhrase?: string;
  undoable: boolean;
  plan: Plan;
}

export type Prepared = { ok: true; kind: 'read'; call: ToolCall } | { ok: true; kind: 'action'; action: PreparedAction } | { ok: false; call: ToolCall; result: ToolResult };

export function permissionOf(name: string): Permission | undefined {
  return TOOL_BY_NAME[name]?.permission;
}

function issueText(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join('.') || 'args'}: ${i.message}`)
    .join('; ');
}

/** Schema validation (zod, from the shared catalogue). */
export function validateCall(call: ToolCall): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const def = TOOL_BY_NAME[call.name];
  if (!def) return { ok: false, error: `Unknown tool "${call.name}".` };
  const parsed = def.schema.safeParse(call.args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments — ${issueText(parsed.error.issues)}` };
  return { ok: true, args: parsed.data as Record<string, unknown> };
}

const fail = (call: ToolCall, error: string): Prepared => ({ ok: false, call, result: { success: false, message: error, error } });

/** Validate a call and, for write tools, build its before→after preview. Nothing is changed. */
export async function prepare(call: ToolCall): Promise<Prepared> {
  const v = validateCall(call);
  if (!v.ok) return fail(call, v.error);
  const permission = permissionOf(call.name)!;
  const clean = { ...call, args: v.args };
  if (permission === 'read') return { ok: true, kind: 'read', call: clean };
  const make = WRITE_TOOLS[call.name];
  if (!make) return fail(call, `Tool "${call.name}" is not available.`);
  try {
    const plan = await make(v.args, await readContext());
    return {
      ok: true,
      kind: 'action',
      action: { call: clean, permission, title: plan.title, lines: plan.lines, warnings: plan.warnings, confirmPhrase: plan.confirmPhrase, undoable: plan.undo !== 'none', plan },
    };
  } catch (e) {
    return fail(call, e instanceof ToolError ? e.message : `Could not prepare this change: ${(e as Error).message}`);
  }
}

export async function runRead(call: ToolCall): Promise<ToolResult> {
  const v = validateCall(call);
  if (!v.ok) return { success: false, message: v.error, error: v.error };
  const fn = READ_TOOLS[call.name];
  if (!fn) return { success: false, message: `Tool "${call.name}" is not a read tool.`, error: 'not_read' };
  try {
    return { success: true, message: 'ok', data: await fn(v.args, await readContext()) };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'Could not read that data.';
    return { success: false, message: msg, error: msg };
  }
}

/**
 * Execute a prepared action (after the user confirmed it). Every tracked record it
 * touches is snapshotted so the change can be undone from the chat.
 */
export async function execute(action: PreparedAction, opts: { source: 'gemini' | 'rules' | 'user'; typedPhrase?: string }): Promise<{ result: ToolResult; events: GameEvent[] }> {
  if (action.confirmPhrase && opts.typedPhrase?.trim() !== action.confirmPhrase) {
    return { result: { success: false, message: `Not applied: type "${action.confirmPhrase}" exactly to confirm.`, error: 'confirmation_required' }, events: [] };
  }
  try {
    const { value, entries } = await recordChanges(() => action.plan.apply());
    let changeId: string | undefined;
    if (action.plan.undo !== 'none') {
      const undo =
        action.plan.undo === 'uncomplete' && typeof value.data?.questId === 'string'
          ? ({ kind: 'uncomplete', questId: value.data.questId } as const)
          : entries.length
            ? ({ kind: 'snapshot', entries } as const)
            : undefined;
      changeId = (await logChange({ tool: action.call.name, summary: action.title, source: opts.source, undo })).id;
    }
    return { result: { success: true, message: value.message, data: value.data, changeId, undoable: !!changeId }, events: value.events };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : `The change failed: ${(e as Error).message}. Nothing was applied.`;
    return { result: { success: false, message: msg, error: msg }, events: [] };
  }
}

export const cancelledResult = (): ToolResult => ({ success: false, cancelled: true, message: 'The user cancelled this change. Nothing was changed.' });

/** Sanity check used by tests: every declared tool has an implementation. */
export function missingImplementations(): string[] {
  return TOOL_DEFS.filter((d) => (d.permission === 'read' ? !READ_TOOLS[d.name] : !WRITE_TOOLS[d.name])).map((d) => d.name);
}
