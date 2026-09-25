import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/primitives';
import { acceptSuggestion, declineSuggestion } from '@/services/suggestionService';
import { useGame } from '@/store/gameStore';
import type { Suggestion } from '@/types';

const ICON: Record<Suggestion['type'], string> = {
  exerciseProgression: '🏋️',
  stepsTarget: '👟',
  caloriesTarget: '🍽️',
  proteinTarget: '🥩',
  cardioStage: '🏃',
  scheduleTime: '🕰️',
  restDay: '🛌',
};

/** System recommendations — never applied without an explicit YES. */
export function SuggestionCards({ limit = 3 }: { limit?: number }) {
  const suggestions = useGame((s) => s.suggestions);
  const act = useGame((s) => s.act);
  const refresh = useGame((s) => s.refresh);
  if (!suggestions.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <AnimatePresence initial={false}>
        {suggestions.slice(0, limit).map((s) => (
          <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -40 }} className="rounded-3xl border border-accent/25 bg-surface p-4 shadow-card">
            <div className="flex items-start gap-3">
              <span className="text-[24px]" aria-hidden>
                {ICON[s.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-extrabold tracking-widest text-accent">SYSTEM RECOMMENDATION</div>
                <div className="text-[15px] font-bold">{s.title}</div>
                <div className="mt-0.5 text-[13px] text-muted">{s.body}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await declineSuggestion(s.id);
                  await refresh();
                }}
              >
                No
              </Button>
              <Button size="sm" onClick={() => void act(acceptSuggestion(s.id))}>
                Yes, apply
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
