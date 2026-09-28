import { useState } from 'react';
import { Field, TextInput } from '@/components/ui/forms';
import { Dialog } from '@/components/ui/Sheet';
import { Button, EmptyState } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { addMemory, clearMemory, listMemory, MEMORY_MAX_CHARS, MEMORY_MAX_NOTES, removeMemory, updateMemory } from '@/services/coachMemoryService';

/** Settings → Coach memory: everything the Coach keeps about you, visible and editable. */
export function MemoryPanel() {
  const { data: notes, reload } = useAsync(() => listMemory(), [], { live: false });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const add = async () => {
    const r = await addMemory(draft);
    setError(r.ok ? null : r.message);
    if (r.ok) setDraft('');
    reload();
  };

  return (
    <div className="mt-3">
      <p className="px-1 text-[13px] text-muted">
        Short notes the Coach keeps about you, only on this device (and in your backups). They’re sent to Gemini only inside a chat you start, so it can respect them. Say “Remember that…” or “Forget…” in the Coach, or edit them here.
      </p>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Add a note" hint={`${draft.length}/${MEMORY_MAX_CHARS}`}>
          <TextInput value={draft} onChange={setDraft} maxLength={MEMORY_MAX_CHARS} placeholder="e.g. I prefer training in the evening" aria-label="New memory note" />
        </Field>
        {error && (
          <p role="alert" className="mt-1 px-1 text-[13px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" block className="mt-2" icon="plus" disabled={draft.trim().length < 2}>
          Remember this
        </Button>
      </form>

      <div className="mt-5 mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-muted">
          Notes · {notes?.length ?? 0}/{MEMORY_MAX_NOTES}
        </span>
        {!!notes?.length && (
          <button type="button" className="hit-44 text-[13px] font-semibold text-danger" onClick={() => setConfirmClear(true)}>
            Forget everything
          </button>
        )}
      </div>
      {notes && !notes.length && <EmptyState icon="📝" title="Nothing remembered yet" body="The Coach never saves notes on its own — only when you ask." />}
      <div className="space-y-2">
        {notes?.map((n) =>
          editing?.id === n.id ? (
            <form
              key={n.id}
              className="rounded-3xl bg-surface p-3 shadow-card"
              onSubmit={async (e) => {
                e.preventDefault();
                await updateMemory(n.id, editing.text);
                setEditing(null);
                reload();
              }}
            >
              <TextInput value={editing.text} onChange={(v) => setEditing({ id: n.id, text: v })} maxLength={MEMORY_MAX_CHARS} aria-label="Edit note" />
              <div className="mt-2 flex gap-2">
                <Button type="submit" size="sm" disabled={editing.text.trim().length < 2}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div key={n.id} className="flex items-start gap-2 rounded-3xl bg-surface p-3 shadow-card">
              <span aria-hidden className="text-[18px]">
                📝
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] [overflow-wrap:anywhere]">{n.text}</div>
                <div className="text-[11px] text-muted">{new Date(n.updatedAt).toLocaleDateString()}</div>
              </div>
              <button type="button" className="hit-44 shrink-0 text-[13px] font-semibold text-accent" onClick={() => setEditing({ id: n.id, text: n.text })}>
                Edit
              </button>
              <button
                type="button"
                className="hit-44 shrink-0 text-[13px] font-semibold text-danger"
                aria-label={`Delete note: ${n.text}`}
                onClick={async () => {
                  await removeMemory(n.id);
                  reload();
                }}
              >
                Delete
              </button>
            </div>
          ),
        )}
      </div>

      <Dialog
        open={confirmClear}
        onCancel={() => setConfirmClear(false)}
        title="Forget everything?"
        message="All Coach memory notes on this device will be deleted. Your game data is not affected."
        confirmLabel="Forget all"
        destructive
        onConfirm={async () => {
          await clearMemory();
          setConfirmClear(false);
          reload();
        }}
      />
    </div>
  );
}
