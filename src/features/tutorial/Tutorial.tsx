import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { create } from 'zustand';
import { Button } from '@/components/ui/primitives';
import { metaRepository } from '@/repositories';
import { useGame } from '@/store/gameStore';

/**
 * Interactive spotlight tutorial over the real UI: each step opens the real screen,
 * highlights a real element and explains it. Starts once after onboarding and can be
 * replayed from Settings → Help.
 */

interface Step {
  route: string;
  target: string;
  title: string;
  body: string;
}

export const TUTORIAL_STEPS: Step[] = [
  { route: '/', target: 'tab-home', title: 'Home', body: 'Your day at a glance: what to do next, today’s quests and how the day is going.' },
  { route: '/', target: 'score', title: 'Today Score', body: 'From 0 to 100. Core quests count most. Tap ⓘ anywhere for a quick explanation.' },
  { route: '/', target: 'energy', title: 'Energy', body: 'Your daily battery. When it’s low, the game asks less of you — core quests stay.' },
  { route: '/quests', target: 'tab-quests', title: 'Quests', body: 'Everything for today and the week: core, important and optional quests, challenges and goals.' },
  { route: '/train', target: 'tab-train', title: 'Train', body: 'Your workout plan, sessions with sets and weights, and cardio. Progression is automatic and safe.' },
  { route: '/nutrition', target: 'scan-food', title: 'Nutrition', body: 'SCAN FOOD estimates a meal from a photo with Gemini — you review and correct it before it’s logged. Manual entry always works.' },
  { route: '/world', target: 'tab-world', title: 'World', body: 'Your Tycoon home. Spend coins on rooms that give real bonuses to your life areas.' },
  { route: '/', target: 'stats', title: 'Stats', body: 'Charts, calendar, records and weekly reviews live here.' },
  { route: '/', target: 'ask', title: 'Coach & voice', body: 'Tap the mic and just say it: “tomorrow at 18 gym”, “protein to 150 g”. The Coach always shows a preview before changing anything.' },
  { route: '/', target: 'profile', title: 'Admin & settings', body: 'Your profile menu: character, settings (AI, targets, schedule), and Admin to edit activities, rules and the economy. Replay this tour in Settings → Help.' },
];

const KEY = 'tutorial';
const useTour = create<{ step: number | null; set: (s: number | null) => void }>((set) => ({ step: null, set: (step) => set({ step }) }));

export function startTutorial(): void {
  useTour.getState().set(0);
}

async function markDone(): Promise<void> {
  await metaRepository.set(KEY, { done: true, at: Date.now() });
}

function useTargetRect(selector: string | null, route: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const location = useLocation();
  useLayoutEffect(() => {
    if (!selector) return setRect(null);
    let raf = 0;
    let tries = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`);
      if (el && location.pathname === route) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 120) raf = requestAnimationFrame(find);
      else setRect(null);
    };
    setRect(null);
    find();
    const onResize = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [selector, route, location.pathname]);
  return rect;
}

export function Tutorial() {
  const { step, set } = useTour();
  const status = useGame((s) => s.status);
  const onboarded = useGame((s) => s.settings?.onboarded);
  const navigate = useNavigate();
  const current = step !== null ? TUTORIAL_STEPS[step] : null;
  const rect = useTargetRect(current?.target ?? null, current?.route ?? null);

  // Auto-start once, after onboarding.
  useEffect(() => {
    if (status !== 'ready' || !onboarded) return;
    let cancelled = false;
    void metaRepository.get<{ done: boolean }>(KEY).then((t) => {
      if (!cancelled && !t?.done && useTour.getState().step === null) setTimeout(() => useTour.getState().step === null && set(0), 1200);
    });
    return () => {
      cancelled = true;
    };
  }, [status, onboarded, set]);

  useEffect(() => {
    if (current) navigate(current.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const finish = useCallback(() => {
    set(null);
    void markDone();
    navigate('/');
  }, [set, navigate]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') set(Math.min(TUTORIAL_STEPS.length - 1, step + 1));
      if (e.key === 'ArrowLeft') set(Math.max(0, step - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, set, finish]);

  if (step === null || !current) return null;
  const pad = 6;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 390;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const below = rect ? rect.top + rect.height / 2 < vh / 2 : true;
  const tipTop = rect ? (below ? Math.min(vh - 230, rect.bottom + pad + 14) : undefined) : vh / 2 - 100;
  const tipBottom = rect && !below ? Math.max(12, vh - rect.top + pad + 14) : undefined;
  const pointerX = rect ? Math.min(vw - 28, Math.max(28, rect.left + rect.width / 2)) : vw / 2;
  const last = step === TUTORIAL_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={`Tutorial step ${step + 1} of ${TUTORIAL_STEPS.length}: ${current.title}`}>
      {/* Spotlight: a transparent hole with a huge shadow around it */}
      <motion.div
        className="pointer-events-none absolute rounded-2xl"
        initial={false}
        animate={rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, opacity: 1 } : { left: vw / 2, top: vh / 2, width: 0, height: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)', outline: '2px solid rgba(255,255,255,0.9)' }}
      />
      <div className="absolute inset-0" aria-hidden />
      {rect && (
        <motion.div
          className="pointer-events-none absolute h-0 w-0"
          initial={false}
          animate={{ left: pointerX - 9, top: below ? rect.bottom + pad + 2 : rect.top - pad - 12 }}
          style={{ borderLeft: '9px solid transparent', borderRight: '9px solid transparent', [below ? 'borderBottom' : 'borderTop']: '10px solid var(--lf-surface)' }}
        />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute inset-x-4 mx-auto max-w-[420px] rounded-3xl bg-surface p-4 shadow-2xl"
          style={{ top: tipTop, bottom: tipBottom }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-extrabold tracking-[0.16em] text-accent">
              TOUR · {step + 1}/{TUTORIAL_STEPS.length}
            </div>
            <button type="button" onClick={finish} className="min-h-11 px-2 text-[14px] font-semibold text-muted">
              Skip
            </button>
          </div>
          <div className="text-[18px] font-bold">{current.title}</div>
          <p className="mt-1 text-[15px] leading-snug text-muted">{current.body}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={step === 0} onClick={() => set(step - 1)}>
              Back
            </Button>
            <Button className="flex-[1.4]" onClick={() => (last ? finish() : set(step + 1))}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
