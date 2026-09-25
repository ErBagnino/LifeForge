import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput } from '@/components/ui/forms';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { buildingCost } from '@/domain/tycoon';
import { useAsync } from '@/hooks';
import { tycoonRepository } from '@/repositories';
import { saveBuilding } from '@/services/adminService';
import { useGame } from '@/store/gameStore';
import type { Building, Cosmetic } from '@/types';
import { formatInt } from '@/utils/format';

export default function EconomyEditor() {
  const refresh = useGame((s) => s.refresh);
  const { data, reload } = useAsync(async () => ({ buildings: await tycoonRepository.buildings.all(), cosmetics: await tycoonRepository.cosmetics.all() }), []);
  const [edits, setEdits] = useState<Record<string, Building>>({});
  const [cos, setCos] = useState<Record<string, Cosmetic>>({});
  if (!data) return null;
  return (
    <Screen back title="Tycoon economy" subtitle="Prices grow exponentially: level n costs base × growth^(n−1).">
      <SectionTitle>Buildings</SectionTitle>
      <div className="space-y-2">
        {data.buildings.map((orig) => {
          const b = edits[orig.id] ?? orig;
          const dirty = !!edits[orig.id];
          const set = (patch: Partial<Building>) => setEdits({ ...edits, [b.id]: { ...b, ...patch } });
          return (
            <Card key={b.id} className="!p-3">
              <div className="text-[15px] font-bold">
                {b.icon} {b.name} <span className="text-muted">· lv {b.level}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="Base cost">
                  <NumberInput value={b.baseCost} onChange={(v) => set({ baseCost: Math.max(0, Math.round(v)) })} aria-label="Base cost" className="!h-11" />
                </Field>
                <Field label="Growth">
                  <NumberInput value={b.costGrowth} onChange={(v) => set({ costGrowth: Math.max(1, v) })} step={0.1} aria-label="Cost growth" className="!h-11" />
                </Field>
                <Field label="Unlock lv">
                  <NumberInput value={b.unlockLevel} onChange={(v) => set({ unlockLevel: Math.max(1, Math.round(v)) })} aria-label="Unlock level" className="!h-11" />
                </Field>
              </div>
              <div className="num mt-2 text-[12px] text-muted">{Array.from({ length: b.maxLevel }, (_, i) => `L${i + 1} ${formatInt(buildingCost(b, i + 1))}`).join(' · ')}</div>
              {dirty && (
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={async () => {
                    await saveBuilding(b);
                    const { [b.id]: _, ...rest } = edits;
                    setEdits(rest);
                    reload();
                    await refresh();
                  }}
                >
                  Save
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      <SectionTitle>Cosmetic prices</SectionTitle>
      <Card className="divide-y divide-line !p-0">
        {data.cosmetics.map((orig) => {
          const c = cos[orig.id] ?? orig;
          return (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-8 text-center">{c.type === 'decoration' ? c.value : c.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">
                {c.name} <span className="text-[11px] text-muted">{c.type}</span>
              </span>
              <NumberInput value={c.price} onChange={(v) => setCos({ ...cos, [c.id]: { ...c, price: Math.max(0, Math.round(v)) } })} aria-label={`${c.name} price`} className="!h-11 !w-24 !px-2" />
            </div>
          );
        })}
      </Card>
      {Object.keys(cos).length > 0 && (
        <Button
          block
          size="lg"
          className="mt-3"
          onClick={async () => {
            await tycoonRepository.cosmetics.bulkPut(Object.values(cos));
            setCos({});
            reload();
          }}
        >
          Save cosmetic prices
        </Button>
      )}
    </Screen>
  );
}
