import { useNavigate } from 'react-router';
import { Card, SectionTitle } from '@/components/ui/primitives';
import { formatDuration, hm } from '@/domain/dailyContext';
import { useAsync } from '@/hooks';
import { workHistory } from '@/services/contextService';
import { useGame } from '@/store/gameStore';
import { formatDate, tsToHm } from '@/utils/date';

/** Work sessions as context (not a competition): averages and the last few days. */
export function WorkStatsCard() {
  const navigate = useNavigate();
  const version = useGame((s) => s.version);
  const { data } = useAsync(() => workHistory(30), [version]);
  if (!data?.rows.length) return null;
  return (
    <>
      <SectionTitle>Work · last 30 days</SectionTitle>
      <Card onClick={() => navigate('/settings/routine')}>
        <div className="num grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[18px] font-bold">{data.avgStartMin !== undefined ? hm(data.avgStartMin) : '—'}</div>
            <div className="text-[11px] text-muted">avg start</div>
          </div>
          <div>
            <div className="text-[18px] font-bold">{data.avgEndMin !== undefined ? hm(data.avgEndMin) : '—'}</div>
            <div className="text-[11px] text-muted">avg end</div>
          </div>
          <div>
            <div className="text-[18px] font-bold">{data.avgMinutes !== undefined ? formatDuration(data.avgMinutes) : '—'}</div>
            <div className="text-[11px] text-muted">avg (incl. commute)</div>
          </div>
        </div>
        <ul className="mt-3 space-y-1 text-[13px]">
          {data.rows.slice(0, 5).map((r) => (
            <li key={r.start} className="num flex justify-between gap-2">
              <span className="truncate text-muted">{formatDate(r.date, 'EEE d MMM')}</span>
              <span className="shrink-0">
                {tsToHm(r.start)}–{tsToHm(r.end)} · {formatDuration(r.minutes)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">Sessions start when you leave home, so the commute is included. Just context for planning your evenings.</p>
      </Card>
    </>
  );
}
