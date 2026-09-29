import { useState } from 'react';
import { Card, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { PERK_EVERY, PERKS, perkSlots } from '@/domain/perks';
import { useAsync, useLevel } from '@/hooks';
import { getPerks, setPerks } from '@/services/progressService';

/** Perks: one small pick every few levels, changeable any time for free. */
export function PerksCard() {
  const { level } = useLevel();
  const { data: picks, reload } = useAsync(() => getPerks(), [level]);
  const [slot, setSlot] = useState<number | null>(null);
  const slots = perkSlots(level);
  const chosen = (picks ?? []).slice(0, slots);
  const nextAt = (slots + 1) * PERK_EVERY;

  const choose = async (id: string | null) => {
    if (slot === null) return;
    const next = [...chosen];
    if (id === null) next.splice(slot, 1);
    else next[slot] = id;
    await setPerks(next.filter(Boolean));
    setSlot(null);
    reload();
  };

  return (
    <Card className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-extrabold tracking-[0.16em] text-muted">PERKS</div>
        <div className="num text-[12px] text-muted">
          {chosen.length}/{slots} · next slot at Lv {nextAt}
        </div>
      </div>
      {slots === 0 ? (
        <p className="mt-2 text-[14px] text-muted">Your first perk slot opens at level {PERK_EVERY}. Perks are small XP bonuses in an area you pick — changeable any time.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: slots }, (_, i) => {
            const p = PERKS.find((x) => x.id === chosen[i]);
            return (
              <button key={i} type="button" onClick={() => setSlot(i)} className={cx('flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left', p ? 'bg-surface-2' : 'border-2 border-dashed border-accent/40 bg-accent/5')}>
                <span className="text-[22px]" aria-hidden>
                  {p?.icon ?? '＋'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{p ? p.name : 'Choose a perk'}</span>
                  <span className="block text-[12px] text-muted">{p ? p.description : 'A free slot — tap to pick one.'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <Sheet open={slot !== null} onClose={() => setSlot(null)} title="Choose a perk">
        <p className="mb-3 text-[13px] text-muted">All perks are worth the same. Pick what you want more of; you can switch later for free.</p>
        <div className="space-y-1.5">
          {PERKS.map((p) => {
            const takenElsewhere = chosen.some((id, i) => id === p.id && i !== slot);
            const current = slot !== null && chosen[slot] === p.id;
            return (
              <button key={p.id} type="button" disabled={takenElsewhere} onClick={() => void choose(p.id)} aria-pressed={current} className={cx('flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left shadow-card', current ? 'bg-accent text-on-accent' : 'bg-surface', takenElsewhere && 'opacity-40')}>
                <span className="text-[22px]" aria-hidden>
                  {p.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{p.name}</span>
                  <span className={cx('block text-[12px]', current ? 'opacity-90' : 'text-muted')}>{takenElsewhere ? 'Already in another slot' : p.description}</span>
                </span>
              </button>
            );
          })}
          {slot !== null && chosen[slot] && (
            <button type="button" onClick={() => void choose(null)} className="hit-44 w-full py-2 text-[14px] font-semibold text-danger">
              Empty this slot
            </button>
          )}
        </div>
      </Sheet>
    </Card>
  );
}
