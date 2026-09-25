import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../ui/primitives';

export interface Series {
  key: string;
  label: string;
  color: string;
}

const axisTick = { fontSize: 10, fill: 'var(--lf-muted)' };
const tooltipStyle = { borderRadius: 12, border: 'none', background: 'var(--lf-surface)', boxShadow: 'var(--lf-shadow-lg)', fontSize: 12 };

/**
 * Chart card: one y-axis, thin marks, recessive grid, hover tooltip, a legend for
 * multi-series charts and a table view for accessibility.
 */
export function ChartCard({
  title,
  subtitle,
  data,
  xKey,
  series,
  kind = 'line',
  height = 180,
  reference,
  format = (v: number) => v.toLocaleString('en-US'),
  empty,
}: {
  title: string;
  subtitle?: ReactNode;
  data: object[];
  xKey: string;
  series: Series[];
  kind?: 'line' | 'bar';
  height?: number;
  reference?: { y: number; label: string };
  format?: (v: number) => string;
  empty?: string;
}) {
  const [table, setTable] = useState(false);
  const rows = data as Record<string, unknown>[];
  const hasData = rows.some((d) => series.some((s) => Number(d[s.key]) > 0));
  return (
    <Card className="mt-2">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold">{title}</div>
          {subtitle && <div className="text-[12px] text-muted">{subtitle}</div>}
        </div>
        <button type="button" className="text-[12px] font-semibold text-accent" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-muted">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {!hasData ? (
        <div className="flex items-center justify-center rounded-2xl bg-surface-2 text-[13px] text-muted" style={{ height }}>
          {empty ?? 'No data yet — log a few days.'}
        </div>
      ) : table ? (
        <div className="max-h-64 overflow-auto rounded-2xl bg-surface-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-3 py-2 font-semibold">{xKey}</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right font-semibold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((d, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-1.5">{String(d[xKey])}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1.5 text-right">
                      {d[s.key] === undefined || d[s.key] === null ? '—' : format(Number(d[s.key]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'bar' ? (
              <BarChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke="var(--lf-border)" vertical={false} />
                <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} minTickGap={12} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} width={46} />
                <Tooltip cursor={{ fill: 'var(--lf-surface-2)' }} contentStyle={tooltipStyle} formatter={(v, n) => [format(Number(v)), series.find((s) => s.key === n)?.label ?? n]} />
                {reference && <ReferenceLine y={reference.y} stroke="var(--lf-muted)" strokeDasharray="4 4" label={{ value: reference.label, fontSize: 10, fill: 'var(--lf-muted)', position: 'insideTopRight' }} />}
                {series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
                ))}
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--lf-border)" vertical={false} />
                <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} width={46} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [format(Number(v)), series.find((s) => s.key === n)?.label ?? n]} />
                {reference && <ReferenceLine y={reference.y} stroke="var(--lf-muted)" strokeDasharray="4 4" label={{ value: reference.label, fontSize: 10, fill: 'var(--lf-muted)', position: 'insideTopRight' }} />}
                {series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--lf-surface)' }} connectNulls />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
