import { InfoTip } from '@/components/ui/InfoTip';
import { useState } from 'react';
import { Ring, ProgressBar } from '@/components/ui/progress';
import { Card } from '@/components/ui/primitives';
import { explainScore, scoreGrade } from '@/domain/score';
import { useGame } from '@/store/gameStore';
import type { ScoreBreakdown } from '@/types';

const GRADE_COLOR: Record<string, string> = { S: '#ff9f0a', A: '#30d158', B: '#0a84ff', C: '#8e8e93', D: '#ff375f' };

export function ScoreCard({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const log = useGame((s) => s.today?.log);
  const threshold = useGame((s) => (s.settings ? s.settings.rules.difficultyPresets[s.settings.difficulty].streakThreshold : 70));
  const [open, setOpen] = useState(defaultOpen);
  const score = log?.score ?? 0;
  const grade = scoreGrade(score);
  const coreLeft = (log?.core.total ?? 0) - (log?.core.done ?? 0);

  return (
    <Card className={defaultOpen ? '' : 'mt-4'} onClick={() => setOpen((v) => !v)} aria-label={`Today score ${score} of 100. Tap for breakdown`}>
      <div className="flex items-center gap-4">
        <Ring value={score / 100} size={108} stroke={11} color={score >= threshold ? 'var(--lf-success)' : 'var(--lf-accent)'} label={`Score ${score}`}>
          <span className="num text-[34px] leading-none font-extrabold">{score}</span>
          <span className="text-[10px] font-bold tracking-widest text-muted">SCORE</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-extrabold tracking-wider text-muted">TODAY</span>
            <InfoTip k="score" />
            <span className="num rounded-lg px-1.5 text-[13px] font-black text-white" style={{ background: GRADE_COLOR[grade] }}>
              {grade}
            </span>
          </div>
          <div className="mt-1 space-y-1.5">
            <TierRow label="Core" done={log?.core.done ?? 0} total={log?.core.total ?? 0} color="var(--lf-accent)" />
            <TierRow label="Important" done={log?.important.done ?? 0} total={log?.important.total ?? 0} color="#0a84ff" />
            <TierRow label="Side" done={log?.optional.done ?? 0} total={log?.optional.total ?? 0} color="var(--lf-success)" />
          </div>
          <div className="num mt-1.5 text-[12px] text-muted">
            {coreLeft > 0 ? `${coreLeft} core left` : log?.core.total ? 'Core done ✓' : 'No core today'} · streak line {threshold}
          </div>
          {log?.breakdown && <div className="mt-1 text-[12px] font-semibold text-accent">{open ? 'Hide details ▴' : 'Why this score? ▾'}</div>}
        </div>
      </div>
      {open && log?.breakdown && <ScoreDetails breakdown={log.breakdown} threshold={threshold} closed={!!log.closed} />}
    </Card>
  );
}

function TierRow({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  if (!total) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-[12px] font-semibold text-muted">{label}</span>
      <ProgressBar value={done / total} color={color} height={6} />
      <span className="num w-9 shrink-0 text-right text-[12px] font-bold">
        {done}/{total}
      </span>
    </div>
  );
}

function ScoreDetails({ breakdown, threshold, closed }: { breakdown: ScoreBreakdown; threshold: number; closed: boolean }) {
  const e = explainScore(breakdown, threshold);
  return (
    <div className="mt-4 border-t border-line pt-3" onClick={(ev) => ev.stopPropagation()}>
      {(e.strongest || e.weakest) && (
        <div className="grid grid-cols-2 gap-2">
          {e.strongest && (
            <div className="rounded-2xl bg-success/10 px-3 py-2">
              <div className="text-[11px] font-bold text-success uppercase">Strongest</div>
              <div className="text-[13px] font-semibold">{e.strongest.label}</div>
            </div>
          )}
          {e.weakest && (
            <div className="rounded-2xl bg-accent/10 px-3 py-2">
              <div className="text-[11px] font-bold text-accent uppercase">Most room</div>
              <div className="text-[13px] font-semibold">{e.weakest.label}</div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 mb-1 text-[12px] font-semibold text-muted">Where the points come from</div>
      <div className="space-y-2">
        {e.contributions.map((c) => (
          <div key={c.key} className="text-[13px]">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-muted">{c.label}</span>
              <span className="num shrink-0 font-semibold">
                {Math.round(c.points)} <span className="font-normal text-faint">/ {Math.round(c.worth)}</span>
              </span>
            </div>
            <ProgressBar value={c.ratio} height={5} className="mt-0.5" label={`${c.label} ${Math.round(c.ratio * 100)}%`} />
          </div>
        ))}
      </div>
      {breakdown.bonus > 0 && <div className="mt-2 text-[12px] font-semibold text-xp">+{breakdown.bonus} achievement bonus</div>}
      {e.notApplicable.length > 0 && <p className="mt-2 text-[12px] text-faint">Not counted today: {e.notApplicable.join(', ')} (their weight goes to the rest).</p>}

      {!closed && (
        <div className="mt-3 rounded-2xl bg-surface-2 px-3 py-2.5">
          <div className="text-[12px] font-semibold text-muted">What can still change today</div>
          {e.canStillChange.length ? (
            <ul className="mt-1 space-y-1">
              {e.canStillChange.map((c) => (
                <li key={c.key} className="flex justify-between gap-2 text-[13px]">
                  <span>{c.hint}</span>
                  <span className="num shrink-0 font-bold text-accent">+{Math.round(c.left)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px]">Nothing left to add — great day.</p>
          )}
          <p className="mt-1.5 text-[12px] text-muted">
            {e.toThreshold > 0 ? `${e.toThreshold} points to the streak line (${threshold}). Up to ${e.reachable} is still reachable.` : `Above the streak line (${threshold}) ✓`}
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">A game metric, not a judgement. Weights are configurable in Admin → Game rules.</p>
    </div>
  );
}
