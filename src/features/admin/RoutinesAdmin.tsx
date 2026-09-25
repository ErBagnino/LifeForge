import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Select, TextInput, TimeInput, Toggle } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useAsync } from '@/hooks';
import { activityRepository, routineRepository } from '@/repositories';
import { deleteRoutine, saveRoutine } from '@/services/adminService';
import { resolveText } from '@/services/game/questFactory';
import { useGame } from '@/store/gameStore';
import type { Routine } from '@/types';
import { uid } from '@/utils/id';

export default function RoutinesAdmin() {
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const { data, reload } = useAsync(async () => ({ routines: await routineRepository.all(), activities: await activityRepository.all() }), []);
  const [edit, setEdit] = useState<Routine | null>(null);
  const [picker, setPicker] = useState(false);
  if (!data) return null;
  const name = (id: string) => {
    const a = data.activities.find((x) => x.id === id);
    return a ? `${a.icon} ${resolveText(a.name, pet)}` : id;
  };
  return (
    <Screen
      back
      title="Routines"
      right={
        <Button size="sm" icon="plus" onClick={() => setEdit({ id: uid('routine_'), name: 'New routine', icon: '✨', kind: 'custom', activityIds: [], timeOfDay: 'anytime', active: true, bonusXp: 20, bonusCoins: 5, createdAt: Date.now(), updatedAt: Date.now() })}>
          New
        </Button>
      }
    >
      <div className="mt-3 space-y-2">
        {data.routines.map((r) => (
          <Card key={r.id} onClick={() => setEdit(structuredClone(r))}>
            <div className="text-[16px] font-bold">
              {r.icon} {r.name} {!r.active && <span className="text-[12px] text-muted">(off)</span>}
            </div>
            <div className="mt-1 text-[12px] text-muted">{r.activityIds.map(name).join(' · ') || 'No activities'}</div>
          </Card>
        ))}
      </div>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Edit routine">
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <Field label="Icon">
                <TextInput value={edit.icon} onChange={(v) => setEdit({ ...edit, icon: v.slice(0, 4) })} aria-label="Icon" />
              </Field>
              <Field label="Name">
                <TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} aria-label="Name" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kind">
                <Select value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={['morning', 'night', 'workout', 'recovery', 'custom'].map((k) => ({ value: k as Routine['kind'], label: k }))} aria-label="Kind" />
              </Field>
              <Field label="Starts at">
                <TimeInput value={edit.startTime ?? ''} onChange={(v) => setEdit({ ...edit, startTime: v || undefined })} aria-label="Start time" />
              </Field>
              <Field label="Bonus XP">
                <NumberInput value={edit.bonusXp} onChange={(v) => setEdit({ ...edit, bonusXp: Math.max(0, Math.round(v)) })} aria-label="Bonus XP" />
              </Field>
              <Field label="Bonus coins">
                <NumberInput value={edit.bonusCoins} onChange={(v) => setEdit({ ...edit, bonusCoins: Math.max(0, Math.round(v)) })} aria-label="Bonus coins" />
              </Field>
            </div>
            <div className="flex items-center justify-between">
              <span>Active</span>
              <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
            </div>
            <SectionTitle action={<button type="button" className="hit-44 text-[13px] font-semibold text-accent" onClick={() => setPicker(true)}>+ Add</button>}>Activities</SectionTitle>
            <div className="space-y-1.5">
              {edit.activityIds.map((id) => (
                <div key={id} className="flex items-center justify-between rounded-2xl bg-surface px-3 py-2 shadow-card">
                  <span className="text-[14px]">{name(id)}</span>
                  <button type="button" aria-label="Remove" className="text-muted" onClick={() => setEdit({ ...edit, activityIds: edit.activityIds.filter((x) => x !== id) })}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="danger"
                icon="trash"
                onClick={async () => {
                  await deleteRoutine(edit.id);
                  setEdit(null);
                  reload();
                }}
              >
                Delete
              </Button>
              <Button
                block
                onClick={async () => {
                  await saveRoutine(edit);
                  setEdit(null);
                  reload();
                }}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <Sheet open={picker} onClose={() => setPicker(false)} title="Add activity">
        <div className="space-y-1.5">
          {data.activities
            .filter((a) => edit && !edit.activityIds.includes(a.id))
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-2xl bg-surface px-3 py-2.5 text-left shadow-card"
                onClick={() => {
                  if (edit) setEdit({ ...edit, activityIds: [...edit.activityIds, a.id] });
                  setPicker(false);
                }}
              >
                {a.icon} <span className="text-[14px]">{resolveText(a.name, pet)}</span>
              </button>
            ))}
        </div>
      </Sheet>
    </Screen>
  );
}
