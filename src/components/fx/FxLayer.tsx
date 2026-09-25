import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RARITY_INFO, STAT_INFO } from '@/data/categories';
import { lastPointer } from '@/hooks';
import type { GameEvent } from '@/services/events';
import { useGame } from '@/store/gameStore';
import type { StatKey } from '@/types';
import { resolveText } from '@/services/game/questFactory';
import { Button } from '../ui/primitives';

type Toast = { id: number; event: GameEvent };
const OVERLAY_TYPES = new Set<GameEvent['type']>(['levelUp', 'achievement', 'building']);
let toastSeq = 0;

function targetOf(id: string): { x: number; y: number } {
  const el = document.getElementById(id);
  if (!el) return { x: window.innerWidth / 2, y: 40 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

interface Particle {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  kind: 'xp' | 'coin';
  delay: number;
}

function Particles({ burst }: { burst: Particle[] }) {
  return (
    <>
      {burst.map((p) => (
        <motion.div
          key={p.id}
          className="pointer-events-none fixed z-[80] flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-black text-white shadow-lg"
          style={{ left: 0, top: 0, background: p.kind === 'xp' ? 'var(--lf-xp)' : 'var(--lf-coin)' }}
          initial={{ x: p.x - 12, y: p.y - 12, scale: 0.4, opacity: 0 }}
          animate={{
            x: [p.x - 12, p.x - 12 + (Math.random() - 0.5) * 120, p.tx - 12],
            y: [p.y - 12, p.y - 60 - Math.random() * 60, p.ty - 12],
            scale: [0.4, 1.1, 0.5],
            opacity: [0, 1, 0.9],
          }}
          transition={{ duration: 0.9, delay: p.delay, ease: [0.3, 0.1, 0.3, 1], times: [0, 0.35, 1] }}
        >
          {p.kind === 'xp' ? '✦' : '●'}
        </motion.div>
      ))}
    </>
  );
}

function ToastCard({ event, onDone }: { event: GameEvent; onDone: () => void }) {
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  useEffect(() => {
    const t = setTimeout(onDone, event.type === 'questComplete' ? 2600 : event.type === 'coach' ? 5200 : 3400);
    return () => clearTimeout(t);
  }, [event, onDone]);

  if (event.type === 'questComplete') {
    const stats = Object.entries(event.stats).filter(([, v]) => (v ?? 0) > 0) as [StatKey, number][];
    const rare = event.rarity !== 'common';
    return (
      <div className="overflow-hidden rounded-3xl bg-surface shadow-float" style={rare ? { boxShadow: `0 0 0 2px ${RARITY_INFO[event.rarity].color}, var(--lf-shadow-lg)` } : undefined}>
        <div className="flex items-center gap-3 p-3.5">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 14 }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success text-[24px] text-white"
          >
            ✓
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-extrabold tracking-wider text-success">
              {event.kind === 'challenge' ? 'CHALLENGE COMPLETE' : event.kind === 'hidden' ? 'HIDDEN QUEST FOUND' : event.kind === 'weekly' ? 'WEEKLY QUEST COMPLETE' : event.kind === 'boss' ? 'BOSS DEFEATED' : 'QUEST COMPLETE'}
            </div>
            <div className="truncate text-[15px] font-semibold">
              {event.icon} {resolveText(event.title, pet)}
            </div>
            <div className="num mt-0.5 flex flex-wrap gap-x-2.5 text-[13px] font-bold">
              <span className="text-xp">+{event.xp} XP</span>
              <span className="text-coin">+{event.coins} COINS</span>
              {stats.slice(0, 2).map(([k, v]) => (
                <span key={k} style={{ color: STAT_INFO[k].color }}>
                  +{v} {STAT_INFO[k].label.toUpperCase()}
                </span>
              ))}
              {event.hp > 0 && <span className="text-hp">+{event.hp} HP</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  let icon = 'ℹ️';
  let text = '';
  let tone = 'info';
  switch (event.type) {
    case 'routine':
      icon = event.icon;
      text = `${event.name} complete! +${event.xp} XP +${event.coins} 🪙`;
      tone = 'success';
      break;
    case 'record':
      icon = '📣';
      text = `New PR! ${event.record.label}: ${event.record.value} ${event.record.unit}`;
      tone = 'success';
      break;
    case 'coach':
      icon = event.icon;
      text = event.text;
      break;
    case 'streak':
      icon = event.kind === 'broken' ? '💔' : event.kind === 'frozen' ? '🧊' : '🔥';
      text =
        event.kind === 'extended'
          ? `${event.value}-day streak! Milestone reached.`
          : event.kind === 'frozen'
            ? `Streak Freeze saved your ${event.value}-day streak.`
            : event.kind === 'revived'
              ? `Streak revived: ${event.value} days!`
              : `Streak of ${event.value} broken. Revive it within 3 days, or start a new one today.`;
      tone = event.kind === 'broken' ? 'warn' : 'success';
      break;
    case 'feature':
      icon = '✨';
      text = `Unlocked: ${event.label}`;
      tone = 'success';
      break;
    case 'purchase':
      icon = event.icon;
      text = `Purchased: ${event.name}`;
      tone = 'success';
      break;
    case 'toast':
      icon = event.icon ?? 'ℹ️';
      text = event.text;
      tone = event.tone ?? 'info';
      break;
    case 'dayClosed':
      icon = event.success ? '🏁' : '🌙';
      text = `Day closed with ${event.score} score${event.success ? ' — streak safe.' : '.'}`;
      break;
    default:
      break;
  }
  return (
    <div className="flex items-start gap-3 rounded-3xl bg-surface p-3.5 shadow-float" style={tone === 'warn' ? { boxShadow: '0 0 0 1.5px var(--lf-warn), var(--lf-shadow-lg)' } : undefined}>
      <span className="text-[22px] leading-none" aria-hidden>
        {icon}
      </span>
      <span className="text-[14px] leading-snug font-medium">{text}</span>
    </div>
  );
}

function LevelUpOverlay({ event, onClose }: { event: Extract<GameEvent, { type: 'levelUp' }>; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label={`Level up to ${event.level}`}>
      <motion.div initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }} className="text-[15px] font-black tracking-[0.3em] text-white/80">
        LEVEL UP
      </motion.div>
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.15 }}
        className="num my-3 flex h-40 w-40 items-center justify-center rounded-full text-[80px] font-black text-white"
        style={{ background: 'radial-gradient(circle at 30% 30%, #b18cff, var(--lf-xp))', boxShadow: '0 0 80px rgba(124,92,255,0.8)' }}
      >
        {event.level}
      </motion.div>
      <div className="mt-2 space-y-1.5">
        {event.perks.map((p, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.12 }} className="rounded-2xl bg-white/10 px-4 py-2 text-[15px] font-semibold text-white">
            {p.type === 'coins' && `🪙 +${p.amount} coins`}
            {p.type === 'item' && `${p.item === 'streakFreeze' ? '🧊 Streak Freeze' : p.item === 'streakRevive' ? '❤️‍🔥 Streak Revive' : '🎲 Quest Reroll'} ×${p.amount}`}
            {p.type === 'feature' && `✨ ${p.label}`}
          </motion.div>
        ))}
      </div>
    </Overlay>
  );
}

function AchievementOverlay({ event, onClose }: { event: Extract<GameEvent, { type: 'achievement' }>; onClose: () => void }) {
  const pet = useGame((s) => s.settings?.profile.petName ?? 'Sky');
  const a = event.achievement;
  const tierColor = { bronze: '#cd7f32', silver: '#c0c7d1', gold: '#ffc233', platinum: '#9be7ff' }[a.tier];
  return (
    <Overlay onClose={onClose} label={`Achievement unlocked: ${a.name}`}>
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-[13px] font-black tracking-[0.3em]" style={{ color: tierColor }}>
        ACHIEVEMENT UNLOCKED
      </motion.div>
      <motion.div
        initial={{ scale: 0, rotate: 180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 13, delay: 0.1 }}
        className="my-5 flex h-36 w-36 items-center justify-center rounded-[40px] text-[72px]"
        style={{ background: `radial-gradient(circle at 30% 25%, ${tierColor}, #222)`, boxShadow: `0 0 70px ${tierColor}99` }}
      >
        {a.icon}
      </motion.div>
      <div className="text-[26px] font-black text-white uppercase">{resolveText(a.name, pet)}</div>
      <div className="mt-1 max-w-[280px] text-[15px] text-white/75">{resolveText(a.description, pet)}</div>
      <div className="num mt-4 flex gap-3 text-[16px] font-bold">
        <span className="rounded-full bg-white/10 px-3 py-1 text-[#b8a6ff]">+{a.xp} XP</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-[#ffd35a]">+{a.coins} 🪙</span>
      </div>
    </Overlay>
  );
}

function BuildingOverlay({ event, onClose }: { event: Extract<GameEvent, { type: 'building' }>; onClose: () => void }) {
  const [built, setBuilt] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => setBuilt(true), reduce ? 0 : 1600);
    return () => clearTimeout(t);
  }, [reduce]);
  return (
    <Overlay onClose={onClose} label={`${event.name} level ${event.level}`}>
      <div className="relative mb-4 flex h-44 w-56 items-end justify-center">
        <AnimatePresence mode="wait">
          {!built ? (
            <motion.div key="build" exit={{ opacity: 0, scale: 0.8 }} className="flex flex-col items-center">
              <motion.div animate={{ rotate: [0, -15, 10, -15, 0] }} transition={{ repeat: Infinity, duration: 0.6 }} className="text-[64px]">
                🔨
              </motion.div>
              <div className="mt-2 text-[40px] tracking-widest">🏗️🚧</div>
              <div className="mt-3 h-2 w-44 overflow-hidden rounded-full bg-white/15">
                <motion.div className="h-full rounded-full bg-[var(--lf-accent)]" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 1.5, ease: 'easeInOut' }} />
              </div>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ scale: 0, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }} className="text-[110px]">
              {event.icon}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="text-[13px] font-black tracking-[0.3em] text-white/70">{built ? (event.level === 1 ? 'UNLOCKED' : 'UPGRADED') : 'CONSTRUCTION…'}</div>
      <div className="mt-1 text-[28px] font-black text-white">{event.name}</div>
      <div className="text-[16px] text-white/70">Level {event.level}</div>
    </Overlay>
  );
}

function Overlay({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
  }, []);
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/85 px-8 text-center backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <Burst />
      <div className="relative flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {children}
        <Button ref={btn} className="mt-8 min-w-[180px]" size="lg" onClick={onClose}>
          Continue
        </Button>
      </div>
    </motion.div>
  );
}

function Burst() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const pieces = Array.from({ length: 26 }, (_, i) => i);
  const colors = ['#ff5a1f', '#7c5cff', '#ffc233', '#30d158', '#0a84ff', '#ff375f'];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((i) => {
        const angle = (i / pieces.length) * Math.PI * 2;
        const dist = 140 + (i % 5) * 40;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 h-2.5 w-2.5 rounded-sm"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist + 120, opacity: 0, rotate: 360 }}
            transition={{ duration: 1.6, ease: 'easeOut', delay: 0.1 }}
          />
        );
      })}
    </div>
  );
}

/** Consumes the store's FX queue: toasts, reward particles and full-screen reward moments. */
export function FxLayer() {
  const fx = useGame((s) => s.fx);
  const shiftFx = useGame((s) => s.shiftFx);
  const reduce = useReducedMotion();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [overlay, setOverlay] = useState<GameEvent | null>(null);
  const [burst, setBurst] = useState<Particle[]>([]);

  useEffect(() => {
    if (overlay || !fx.length) return;
    const next = fx[0];
    shiftFx();
    if (OVERLAY_TYPES.has(next.type)) {
      setOverlay(next);
      return;
    }
    setToasts((t) => [...t.slice(-2), { id: ++toastSeq, event: next }]);
    if (next.type === 'questComplete' && !reduce) {
      const from = lastPointer.x ? { x: lastPointer.x, y: lastPointer.y } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const xpT = targetOf('hud-xp');
      const coinT = targetOf('hud-coins');
      const n = Math.min(10, 4 + Math.round(next.xp / 40));
      const parts: Particle[] = Array.from({ length: n }, (_, i) => ({
        id: toastSeq * 100 + i,
        x: from.x,
        y: from.y,
        tx: i % 3 === 2 ? coinT.x : xpT.x,
        ty: i % 3 === 2 ? coinT.y : xpT.y,
        kind: i % 3 === 2 ? 'coin' : 'xp',
        delay: i * 0.035,
      }));
      setBurst((b) => [...b, ...parts]);
      setTimeout(() => setBurst((b) => b.filter((p) => !parts.includes(p))), 1400);
    }
  }, [fx, overlay, shiftFx, reduce]);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] mx-auto flex max-w-[640px] flex-col gap-2 px-3 pt-[calc(var(--safe-top)+8px)]" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="pointer-events-auto"
              onClick={() => dismiss(t.id)}
            >
              <ToastCard event={t.event} onDone={() => dismiss(t.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <Particles burst={burst} />
      <AnimatePresence>
        {overlay?.type === 'levelUp' && <LevelUpOverlay key="lvl" event={overlay} onClose={() => setOverlay(null)} />}
        {overlay?.type === 'achievement' && <AchievementOverlay key={overlay.achievement.id} event={overlay} onClose={() => setOverlay(null)} />}
        {overlay?.type === 'building' && <BuildingOverlay key={`${overlay.buildingId}${overlay.level}`} event={overlay} onClose={() => setOverlay(null)} />}
      </AnimatePresence>
    </>,
    document.body,
  );
}
