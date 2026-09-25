import { useMemo, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Segmented } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Card, cx } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useAsync } from '@/hooks';
import { statsRepository } from '@/repositories';
import { clock } from '@/services/clock';
import type { DayLog, ISODate } from '@/types';
import { dateRange, formatDate, monthEnd, monthStart, shiftDate, weekday, weekEnd, weekStart } from '@/utils/date';
import { formatInt } from '@/utils/format';
import { DayDetail } from './DayDetail';

type View = 'month' | 'week' | 'day';

function scoreColor(score: number): string {
  if (score <= 0) return 'var(--lf-surface-2)';
  const pct = Math.round(20 + (Math.min(100, score) / 100) * 75);
  return `color-mix(in srgb, var(--lf-accent) ${pct}%, var(--lf-surface-2))`;
}

export default function CalendarScreen() {
  const today = clock.today();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState<ISODate>(today);
  const [selected, setSelected] = useState<ISODate | null>(null);
  const range = useMemo(() => {
    if (view === 'month') return { from: weekStart(monthStart(anchor)), to: weekEnd(monthEnd(anchor)) };
    if (view === 'week') return { from: weekStart(anchor), to: weekEnd(anchor) };
    return { from: anchor, to: anchor };
  }, [view, anchor]);
  const { data: logs } = useAsync(async () => new Map((await statsRepository.logs(range.from, range.to)).map((l) => [l.date, l])), [range.from, range.to]);

  const shift = (dir: 1 | -1) => {
    if (view === 'month') {
      const d = new Date(`${monthStart(anchor)}T12:00:00`);
      d.setMonth(d.getMonth() + dir);
      setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    } else setAnchor(shiftDate(anchor, dir * (view === 'week' ? 7 : 1)));
  };
  const title = view === 'month' ? formatDate(anchor, 'MMMM yyyy') : view === 'week' ? `${formatDate(range.from, 'd MMM')} – ${formatDate(range.to, 'd MMM')}` : formatDate(anchor, 'EEEE d MMMM');

  return (
    <Screen back title="Calendar">
      <Segmented
        className="mt-2"
        value={view}
        onChange={setView}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'Week' },
          { value: 'day', label: 'Day' },
        ]}
      />
      <div className="mt-3 flex items-center justify-between">
        <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-card">
          <Icon name="chevronLeft" />
        </button>
        <div className="text-[17px] font-bold">{title}</div>
        <button type="button" aria-label="Next" onClick={() => shift(1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface shadow-card">
          <Icon name="chevronRight" />
        </button>
      </div>

      {view === 'month' && (
        <Card className="mt-3 !p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {dateRange(range.from, range.to).map((d) => {
              const log = logs?.get(d);
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              const future = d > today;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={future}
                  onClick={() => setSelected(d)}
                  className={cx('relative flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] font-semibold', !inMonth && 'opacity-35', d === today && 'ring-2 ring-accent')}
                  style={{ background: future ? 'transparent' : scoreColor(log?.score ?? 0), color: (log?.score ?? 0) > 55 ? 'white' : undefined }}
                  aria-label={`${formatDate(d, 'd MMMM')}${log ? `, score ${log.score}` : ''}`}
                >
                  <span>{Number(d.slice(8))}</span>
                  {log && log.score > 0 && <span className="num text-[9px] opacity-90">{log.score}</span>}
                  <span className="absolute top-0.5 right-1 flex gap-0.5 text-[7px]">
                    {log?.workouts ? '●' : ''}
                    {log?.achievements.length ? '★' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
            <span>● workout · ★ achievement</span>
            <span className="flex items-center gap-1">
              low
              {[10, 40, 70, 100].map((s) => (
                <span key={s} className="h-3 w-3 rounded" style={{ background: scoreColor(s) }} />
              ))}
              high
            </span>
          </div>
        </Card>
      )}

      {view === 'week' && (
        <div className="mt-3 space-y-2">
          {dateRange(range.from, range.to).map((d) => (
            <WeekRow key={d} date={d} log={logs?.get(d)} future={d > today} onClick={() => setSelected(d)} />
          ))}
        </div>
      )}

      {view === 'day' && (
        <div className="mt-3">
          <DayDetail date={anchor} />
        </div>
      )}

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected ? formatDate(selected, 'EEEE d MMMM') : ''}>
        {selected && <DayDetail date={selected} />}
      </Sheet>
    </Screen>
  );
}

function WeekRow({ date, log, future, onClick }: { date: ISODate; log?: DayLog; future: boolean; onClick: () => void }) {
  const total = (log?.core.total ?? 0) + (log?.important.total ?? 0) + (log?.optional.total ?? 0);
  const done = (log?.core.done ?? 0) + (log?.important.done ?? 0) + (log?.optional.done ?? 0);
  return (
    <button type="button" disabled={future} onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-3xl bg-surface p-3 text-left shadow-card', future && 'opacity-40')}>
      <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl text-white" style={{ background: scoreColor(log?.score ?? 0) }}>
        <span className="text-[10px] font-bold opacity-90">{['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][weekday(date)]}</span>
        <span className="num text-[16px] font-extrabold">{Number(date.slice(8))}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="num text-[15px] font-bold">{log ? `Score ${log.score}` : future ? 'Upcoming' : 'No data'}</div>
        {log && (
          <div className="num text-[12px] text-muted">
            {done}/{total} quests · +{formatInt(log.xp)} XP · +{formatInt(log.coins)} 🪙 {log.workouts ? '· 🏋️' : ''} {log.success ? `· 🔥${log.streak}` : ''}
          </div>
        )}
      </div>
      <Icon name="chevronRight" size={18} className="text-faint" />
    </button>
  );
}
