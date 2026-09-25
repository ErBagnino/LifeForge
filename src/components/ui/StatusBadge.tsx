import type { FieldStatus } from '@/types';
import { cx } from './primitives';

/** SET / NOT SET / OPTIONAL. "Not set" is information, never an error colour. */
export function StatusBadge({ status }: { status: FieldStatus }) {
  return (
    <span
      className={cx(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide',
        status === 'set' ? 'bg-success/15 text-success' : status === 'optional' ? 'bg-surface-2 text-muted' : 'bg-accent/10 text-accent',
      )}
    >
      {status === 'set' ? 'SET' : status === 'optional' ? 'OPTIONAL' : 'NOT SET'}
    </span>
  );
}
