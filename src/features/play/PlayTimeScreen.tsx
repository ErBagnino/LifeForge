import { useState } from 'react';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Screen } from '@/components/layout/Screen';
import { Field, List, NumberInput, Row } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { Ring } from '@/components/ui/progress';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { LEISURE_KINDS } from '@/domain/leisure';
import { useAsync } from '@/hooks';
import { metaRepository, statsRepository } from '@/repositories';
import { clock } from '@/services/clock';
import { dailySeries } from '@/services/insightsService';
import { cancelLeisure, deleteMetric, logMetric } from '@/services/metricsService';
import { useGame } from '@/store/gameStore';
import type { LeisureKind } from '@/types';
import { shiftDate, tsToHm } from '@/utils/date';
import { formatClock, usePlayActions, usePlayTime } from './PlayTimeCard';

export default function PlayTimeScreen() {
  const p = usePlayTime();
  const { start, stop } = usePlayActions();
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  const [manual, setManual] = useState(15);
  const today = clock.today();
  const { data: series } = useAsync(() => dailySeries(shiftDate(today, -13), today), [today]);
  const { data: entries } = useAsync(async () => (await statsRepository.metricsByDate(today)).filter((m) => m.type === 'leisure').sort((a, b) => b.ts - a.ts), [today]);
  const color = p.status === 'over' ? 'var(--lf-danger)' : p.status === 'warn' ? 'var(--lf-warn)' : 'var(--lf-success)';
  const { data: adventureStart } = useAsync(() => metaRepository.get<string>('adventureStart'), []);
  // Only days since the adventure started count: days before it have no data, not a success.
  const past = series?.filter((d) => d.date !== today && (!adventureStart || d.date >= adventureStart)) ?? [];
  const underDays = past.filter((d) => d.leisure <= p.limit).length;

  return (
    <Screen back title="Play time" subtitle={`Daily budget: ${p.limit} min (games, TikTok, reels, streaming). Video calls with your partner never count.`}>
      <Card className="mt-3 flex flex-col items-center py-6">
        <Ring value={p.used / p.limit} size={190} stroke={16} color={color} label="Play time used today">
          <div className="num text-[38px] font-extrabold" style={{ color }}>
            {p.timer ? formatClock(p.runningSec) : Math.round(p.used)}
          </div>
          <div className="text-[13px] text-muted">{p.timer ? `${Math.round(p.used)} / ${p.limit} min` : `of ${p.limit} min`}</div>
        </Ring>
        <div className="mt-3 text-[15px] font-semibold" style={{ color }}>
          {p.status === 'over' ? `${Math.round(p.used - p.limit)} min over budget` : `${Math.round(p.remaining)} min left today`}
        </div>
        {p.timer ? (
          <div className="mt-4 flex w-full gap-2">
            <Button variant="secondary" className="flex-1" onClick={async () => { await cancelLeisure(); await refresh(); }}>
              Discard
            </Button>
            <Button variant="danger" size="lg" icon="stop" className="flex-[2] !bg-danger !text-white" onClick={() => void stop()}>
              Stop
            </Button>
          </div>
        ) : (
          <div className="mt-4 grid w-full grid-cols-2 gap-2">
            {(Object.keys(LEISURE_KINDS) as LeisureKind[]).map((k) => (
              <Button key={k} variant={k === 'games' ? 'primary' : 'secondary'} onClick={() => void start(k)}>
                {LEISURE_KINDS[k].icon} {LEISURE_KINDS[k].short}
              </Button>
            ))}
          </div>
        )}
        {p.timer && <p className="mt-3 text-center text-[12px] text-muted">The timer is saved on the device: close the app, play, come back and stop it. You’ll get a reminder near the limit while the app is open (or via push, if configured).</p>}
      </Card>

      <SectionTitle>Forgot the timer?</SectionTitle>
      <Card>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Add minutes manually">
              <NumberInput value={manual} onChange={setManual} min={1} max={600} aria-label="Minutes" />
            </Field>
          </div>
          <Button size="lg" icon="plus" onClick={() => void act(logMetric('leisure', Math.round(manual), { note: 'manual' }))}>
            Add
          </Button>
        </div>
      </Card>

      {!!entries?.length && (
        <List title="Today's sessions">
          {entries.map((e) => (
            <Row
              key={e.id}
              icon={LEISURE_KINDS[(e.note as LeisureKind) ?? 'other']?.icon ?? '🕹️'}
              title={`${Math.round(e.value)} min`}
              subtitle={`${LEISURE_KINDS[(e.note as LeisureKind) ?? 'other']?.label ?? 'Manual'} · ${tsToHm(e.ts)}`}
              right={
                <button type="button" aria-label="Delete session" className="flex h-11 w-11 items-center justify-center rounded-full text-muted" onClick={() => void act(deleteMetric(e))}>
                  <Icon name="trash" size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}

      <SectionTitle>Last 14 days</SectionTitle>
      <Card>
        <div className="mb-2 text-[13px] text-muted">
          {past.length ? (
            <>
              Under budget on <span className="font-bold text-success">{underDays}</span> of the last {past.length} {past.length === 1 ? 'day' : 'days'}.
            </>
          ) : (
            'Your first day — this view fills in as the days go by.'
          )}
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series ?? []} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--lf-muted)' }} tickLine={false} axisLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--lf-muted)' }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'var(--lf-surface-2)' }} contentStyle={{ borderRadius: 12, border: 'none', background: 'var(--lf-surface)' }} formatter={(v) => [`${v} min`, 'Play time']} />
              <ReferenceLine y={p.limit} stroke="var(--lf-danger)" strokeDasharray="4 4" />
              <Bar dataKey="leisure" radius={[6, 6, 0, 0]} fill="var(--lf-accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <p className="mt-3 px-1 text-[12px] text-muted">Change the budget in Settings → Targets. Staying under it completes the 🎮 core quest at the end of the day.</p>
    </Screen>
  );
}
