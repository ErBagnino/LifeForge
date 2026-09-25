import { useNavigate } from 'react-router';
import { Collapsible } from '@/components/ui/Collapsible';
import { ProgressBar } from '@/components/ui/progress';
import { Button, Card, Kpi } from '@/components/ui/primitives';
import { useGame } from '@/store/gameStore';
import { formatInt } from '@/utils/format';

/** Compact nutrition glance for Today (details live on the Nutrition screen). */
export function NutritionGlance() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const m = useGame((s) => s.today?.log?.metrics);
  if (!settings?.tracking.nutrition) return null;
  const n = settings.nutrition;
  const rows = [
    { label: 'Calories', value: m?.calories ?? 0, target: n.calories, unit: 'kcal', color: 'var(--lf-accent)' },
    { label: 'Protein', value: m?.protein ?? 0, target: n.protein, unit: 'g', color: '#ff5a5f' },
    { label: 'Water', value: (m?.water ?? 0) / 1000, target: settings.hydration.targetMl / 1000, unit: 'L', color: 'var(--lf-energy)' },
  ];
  return (
    <Collapsible id="nutrition" title="Nutrition" meta={`${formatInt(m?.calories ?? 0)} kcal`} defaultOpen={false}>
      <Card className="!p-3">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex justify-between gap-2 text-[13px]">
                <span className="font-semibold">{r.label}</span>
                <span className="num shrink-0 text-muted">
                  {r.unit === 'L' ? r.value.toFixed(1) : formatInt(r.value)} / {r.unit === 'L' ? r.target.toFixed(1) : formatInt(r.target)} {r.unit}
                </span>
              </div>
              <ProgressBar value={r.value / r.target} color={r.color} height={6} className="mt-1" label={r.label} />
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" icon="camera" className="!h-11" onClick={() => navigate('/nutrition/scan')}>
            Photo
          </Button>
          <Button size="sm" variant="secondary" className="!h-11" onClick={() => navigate('/nutrition')}>
            Open nutrition
          </Button>
        </div>
      </Card>
    </Collapsible>
  );
}

/** Tiny stats strip for Today (full stats on the Stats tab). */
export function StatsGlance() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const log = useGame((s) => s.today?.log);
  if (!player) return null;
  return (
    <Collapsible id="stats" title="Stats" defaultOpen={false} right={<button type="button" onClick={() => navigate('/stats')} className="h-11 px-2 text-[13px] font-semibold text-accent">All stats</button>}>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Streak" value={`${player.streak.current} d`} icon="🔥" sub={`best ${player.streak.longest}`} />
        <Kpi label="XP today" value={`+${formatInt(log?.xp ?? 0)}`} icon="✨" />
        <Kpi label="Coins today" value={`+${formatInt(log?.coins ?? 0)}`} icon="🪙" />
      </div>
    </Collapsible>
  );
}
