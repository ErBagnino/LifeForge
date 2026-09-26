import { useState } from 'react';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** Contextual help texts (ⓘ buttons). Plain language, no jargon. */
export const INFO = {
  energy: { title: 'Energy ⚡', body: 'Your daily battery. It starts each morning from sleep and rest days. Quests cost energy; recovery activities (walks, stretching, rest) give some back. When energy is low, the game asks less of you.' },
  hp: { title: 'HP ❤️', body: 'The health of your habit system. It drops when core quests are missed and recovers when you complete them. At 0 HP you enter a gentle Recovery Mode with fewer, easier quests — no punishment.' },
  score: { title: 'Today Score', body: 'How well today is going, from 0 to 100. Core quests count most, then important and optional ones, plus steps, nutrition, water and routines. Components that don’t apply today are left out, not counted as zero.' },
  xp: { title: 'XP & level', body: 'Every completed quest gives XP. Levels unlock features, rooms and rewards. Harder and longer quests give more — computed by the game engine, never by the AI.' },
  coins: { title: 'Coins 🪙', body: 'Earned from quests and your Tycoon world. Spend them on rooms, cosmetics and helpful items like streak freezes.' },
  streak: { title: 'Streak 🔥', body: 'Days in a row with a successful day. A streak freeze protects one missed day; a revive can bring back a broken streak.' },
  load: { title: 'Today’s load', body: 'Planned quest time compared with your estimated free time and energy. When a day is full, optional quests are lightened first — core quests stay. You can always keep a task.' },
  core: { title: 'Core · Important · Optional', body: 'Core quests are the essentials that protect your day. Important ones matter but can move. Optional ones are extra XP when you have time.' },
  aiEstimate: { title: 'AI estimate', body: 'Calories and macros estimated by Gemini from a photo. Portions and hidden ingredients (oil, sauces) make it approximate — you can correct it before logging.' },
} as const;

export type InfoKey = keyof typeof INFO;

export function InfoTip({ k, className }: { k: InfoKey; className?: string }) {
  const [open, setOpen] = useState(false);
  const info = INFO[k];
  return (
    <>
      <button
        type="button"
        aria-label={`What is ${info.title}?`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`hit-44 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint ${className ?? ''}`}
      >
        <Icon name="info" size={14} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={info.title}>
        <p className="pb-2 text-[15px] leading-relaxed">{info.body}</p>
      </Sheet>
    </>
  );
}
