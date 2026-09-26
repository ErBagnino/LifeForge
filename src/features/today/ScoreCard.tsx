import { InfoTip } from '@/components/ui/InfoTip';
import { useState } from 'react';
import { Ring, ProgressBar } from '@/components/ui/progress';
import { Card } from '@/components/ui/primitives';
import { SCORE_COMPONENT_LABELS, scoreGrade } from '@/domain/score';
import { useGame } from '@/store/gameStore';

const GRADE_COLOR: Record<string, string> = { S: '#ff9f0a', A: '#30d158', B: '#0a84ff', C: '#8e8e93', D: '#ff375f' };

export function ScoreCard() {
  const log = useGame((s) => s.today?.log);
  const threshold = useGame((s) => (s.settings ? s.settings.rules.difficultyPresets[s.settings.difficulty].streakThreshold : 70));
  const [open, setOpen] = useState(false);
  const score = log?.score ?? 0;
  const grade = scoreGrade(score);
  const coreLeft = (log?.core.total ?? 0) - (log?.core.done ?? 0);

  return (
    <Card className="mt-4" data-tour="score" onClick={() => setOpen((v) => !v)} aria-label={`Today score ${score} of 100. Tap for breakdown`}>
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
      {open && log?.breakdown && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          {log.breakdown.components.map((c) => (
            <div key={c.key} className="flex items-center gap-2 text-[13px]">
              <span className="w-28 shrink-0 text-muted">{SCORE_COMPONENT_LABELS[c.key]}</span>
              {c.ratio === null ? (
                <span className="text-[12px] text-faint">not applicable today</span>
              ) : (
                <>
                  <ProgressBar value={c.ratio} height={6} />
                  <span className="num w-10 shrink-0 text-right font-semibold">{Math.round(c.ratio * 100)}%</span>
                </>
              )}
            </div>
          ))}
          {log.breakdown.bonus > 0 && <div className="text-[12px] font-semibold text-xp">+{log.breakdown.bonus} achievement bonus</div>}
          <p className="text-[11px] text-muted">A game metric, not a judgement. Weights are configurable in Admin → Game rules.</p>
        </div>
      )}
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
