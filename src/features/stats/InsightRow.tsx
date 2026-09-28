import type { Insight } from '@/domain/coach';

/** One insight; tap "Why?" to see the data and time window it was computed from. */
export function InsightRow({ insight }: { insight: Insight }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[20px]" aria-hidden>
          {insight.icon}
        </span>
        <span className="min-w-0 flex-1 text-[14px] leading-snug">
          {insight.text} {insight.source && <span className="text-[12px] font-semibold whitespace-nowrap text-accent group-open:hidden">Why?</span>}
        </span>
      </summary>
      {insight.source && <p className="mt-1 ml-8 rounded-2xl bg-surface-2 px-3 py-2 text-[12px] text-muted">📊 {insight.source}</p>}
    </details>
  );
}
