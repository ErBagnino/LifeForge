import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { ProgressBar } from '@/components/ui/progress';
import { Card, EmptyState, SectionTitle, Skeleton, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { DAILY_WEIGHTS, MASTERY_MAX_LEVEL, type TrackMastery } from '@/domain/mastery';
import { useAsync } from '@/hooks';
import { equipTitle, getEquippedTitle, loadMastery } from '@/services/progressService';
import { useGame } from '@/store/gameStore';
import { PerksCard } from './PerksCard';
import { formatDate } from '@/utils/date';

/** Mastery: ten life tracks that grow from real completions, with equippable perk titles. */
export default function MasteryScreen() {
  const pushFx = useGame((s) => s.pushFx);
  const { data, reload } = useAsync(async () => ({ tracks: await loadMastery(), title: await getEquippedTitle() }), []);
  const [open, setOpen] = useState<TrackMastery | null>(null);
  if (!data) {
    return (
      <Screen back title="Mastery & perks">
        <Skeleton className="mt-3 h-24" />
        <Skeleton className="mt-2 h-24" />
      </Screen>
    );
  }
  const started = data.tracks.filter((t) => t.completions > 0);
  const sorted = [...data.tracks].sort((a, b) => b.points - a.points);
  const equip = async (id: string | null) => {
    const r = await equipTitle(id);
    pushFx({ type: 'toast', text: r.message, tone: r.ok ? 'success' : 'warn' });
    reload();
  };

  return (
    <Screen back title="Mastery & perks" subtitle="Grows with every day you show up — spreading effort over days counts more than grinding one afternoon.">
      <PerksCard />
      <Card className="mt-3">
        <div className="text-[12px] font-semibold text-muted uppercase">Equipped title</div>
        <div className="mt-1 text-[18px] font-extrabold">{data.title ? data.title.title : 'None yet'}</div>
        <p className="mt-1 text-[12px] text-muted">{data.title ? 'Shown on your character. Change it from any track below.' : `Titles unlock at mastery 5, 10, 15 and 20 in each track. They are cosmetic — no pressure.`}</p>
        {data.title && (
          <button type="button" className="hit-44 mt-1 text-[13px] font-semibold text-accent" onClick={() => void equip(null)}>
            Remove title
          </button>
        )}
      </Card>

      {!started.length && <EmptyState icon="🌱" title="No mastery yet" body="Complete any quest and its track starts growing. Everything here comes from what you actually did." />}

      <SectionTitle>Tracks</SectionTitle>
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        {sorted.map((t) => (
          <button key={t.id} type="button" onClick={() => setOpen(t)} className="rounded-3xl bg-surface p-3 text-left shadow-card" aria-label={`${t.label} mastery level ${t.level}`}>
            <div className="flex items-center gap-3">
              <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[22px]', !t.completions && 'grayscale')} style={{ background: `color-mix(in srgb, ${t.color} 18%, transparent)` }} aria-hidden>
                {t.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-bold">{t.label}</span>
                  <span className="num shrink-0 text-[13px] font-extrabold">{t.level >= MASTERY_MAX_LEVEL ? 'MAX' : `Lv ${t.level}`}</span>
                </div>
                <ProgressBar value={t.progress} color={t.color} height={5} className="mt-1" />
                <div className="num mt-0.5 flex justify-between text-[11px] text-muted">
                  <span>{t.completions ? `${t.activeDays} active ${t.activeDays === 1 ? 'day' : 'days'}` : 'Not started'}</span>
                  <span>{t.recent > 0 ? `+${t.recent} this week` : ''}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 px-1 text-[12px] text-muted">
        How it works: each completed quest adds mastery to its track. The 1st completion of a track on a day counts {DAILY_WEIGHTS[0]}, the 2nd {DAILY_WEIGHTS[1]}, the 3rd {DAILY_WEIGHTS[2]} and so on — mastery never decreases and never costs anything.
      </p>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.icon} ${open.label}` : ''}>
        {open && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Level" value={open.level >= MASTERY_MAX_LEVEL ? 'MAX' : String(open.level)} />
              <Stat label="Completions" value={String(open.completions)} />
              <Stat label="Active days" value={String(open.activeDays)} />
            </div>
            <div className="mt-3 text-[13px] text-muted">
              {open.level >= MASTERY_MAX_LEVEL ? 'Fully mastered.' : `${Math.round(open.into * 10) / 10} / ${open.needed} mastery to level ${open.level + 1}`}
              {open.lastDate && ` · last ${formatDate(open.lastDate)}`}
            </div>
            <ProgressBar value={open.progress} color={open.color} height={8} className="mt-1.5" />
            <SectionTitle>Perk titles</SectionTitle>
            <div className="space-y-1.5">
              {open.perks.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 shadow-card">
                  <div className="min-w-0">
                    <div className={cx('text-[15px] font-bold', !p.unlocked && 'text-muted')}>{p.unlocked ? p.title : `🔒 ${p.title}`}</div>
                    <div className="text-[12px] text-muted">Mastery {p.level}</div>
                  </div>
                  {p.unlocked &&
                    (data.title?.id === p.id ? (
                      <span className="text-[13px] font-semibold text-success">Equipped</span>
                    ) : (
                      <button type="button" className="hit-44 shrink-0 rounded-full bg-accent/12 px-3 py-1.5 text-[13px] font-semibold text-accent" onClick={() => void equip(p.id)}>
                        Equip
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
      <div className="num text-[20px] font-extrabold">{value}</div>
      <div className="text-[11px] font-semibold text-muted">{label}</div>
    </div>
  );
}
