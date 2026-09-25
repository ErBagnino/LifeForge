# Game design

**Pillar:** your real life is the game. The app only rewards things that are good for you, keeps the first days
light, makes progress visible every day, and never punishes you into quitting.

```
real life ──► quest ──► XP · coins · stats ──► level & unlocks ──► build your world ──► new quests ──► review ─┐
    ▲                                                                                                          │
    └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

All numbers below are defaults from `src/data/defaultRules.ts` and `src/data/defaultSettings.ts`. You can change every one
of them in **Admin** or **Settings**.

---

## 1. Player resources

| Resource | What it is | Where it comes from |
| --- | --- | --- |
| **XP / Level** | Long-term progress. Levels unlock features and give perks. | Quests, workouts, routines, achievements. |
| **Coins 🪙** | Spendable currency. Coins only buy game things or permission for real rewards you've approved. There's no real money anywhere. | Quests (≈30% of XP), level-ups, streak milestones, world income. |
| **HP ❤️ (0–100)** | How well you're looking after yourself *lately*. | + core quests, perfect core days, rest days handled well, recovery activities. − missed core/important quests, collapsing consistency (capped). |
| **Energy ⚡ (0–100+)** | Today's battery. Effortful quests cost energy; rest, sleep and mental wellbeing restore it. | Starts from last night's sleep (or 85 if unknown). Max energy grows with the world. |
| **Stats** | Strength · Endurance · Discipline · Health · Order · Care · Consistency · Knowledge. | Each activity awards stat points. Stats drive the radar chart and your class. |
| **Items** | Streak Freeze 🧊 · Streak Revive ❤️‍🔥 · Quest Reroll 🎲 · XP Booster 🚀 · Coin Magnet 🧲. | Earned by playing (level perks every 3/5/10 levels, achievements) or bought with coins. |

## 2. Quests

| Type | Purpose | Unlock |
| --- | --- | --- |
| **Core** | The non-negotiables that define a good day (hydration, meals, teeth, NoFap, play-time budget, steps, protein, workout on training days). They carry 45% of the score. | Day 1 |
| **Important** | Valuable but flexible (cardio program, chores, skincare, planning…). | Day 1 |
| **Side** | Generated each day to fit your free time and energy. They add to the day and can never ruin it. | Level 2 |
| **Daily Challenge** | One slightly harder, higher-reward quest per day. | Level 3 |
| **Hidden** | A secret quest, revealed only when you do it. | Level 4 |
| **Weekly** | 3 multi-day goals (e.g. "4 workouts this week"). | Level 5 |
| **Boss** | A big weekly goal with a large payout. | Level 8 |

Feature gates keep day 1 approachable: you start with core + important quests and a single first quest ("Drink a glass of water").

**Actions** on a quest: complete (with undo), log a metric (auto-completes at the target), start now, snooze
(30 min · 1 h · tonight · tomorrow), reschedule, move to tomorrow, skip (with an optional reason), reroll (side quests, costs a
Reroll item or coins), edit, delete. After 3 snoozes the quest card warns you. Snoozes beyond that cost a couple of coins at
day close (capped with the other coin penalties).

**Rarity** (side/challenge): common 68% · uncommon 22% · rare 7% · epic 2.5% · legendary 0.5%. Rarer quests pay more (×1.25 … ×3).

### Side-quest generator (no AI)
`domain/questGenerator.ts` scores every eligible activity:

- **fits now**: duration ≤ free minutes before the next busy block, time-of-day window, weekday availability;
- **energy**: skips hard quests when the battery is low and prefers recovery activities;
- **workload**: 4 side quests on light days, 2 on medium, 1 on heavy ones, with shorter max durations as the day fills;
- **variety**: avoids anything done in the last 3 days, one quest per category, and favours areas you haven't touched in
  a week or chose as focus areas;
- **scaling**: scalable activities shrink to fit (e.g. "read 10 pages" instead of 30).

It's seeded by date, so reopening the app never reshuffles the board. A reroll uses a fresh seed.

**Habit learning** (`domain/habits.ts`) is separate: it learns when you actually complete recurring quests and proposes
moving their planned time (e.g. "you usually read at 22:40, move it from 21:00?"). You accept or dismiss it.

### Workload awareness
The day's workload (0–100) comes from work hours, busy blocks, planned quests and the workout. A 10-hour workday usually lands
in "high": you get about 3–5 realistic effortful core quests, and trivial ones (≤ 5 min) are exempt from the cap. Chores
move to free days, cardio avoids gym days, and side quests shrink to one short option.

### Adaptive difficulty
Every morning the game classifies you as **too easy / balanced / overloaded / critical** from recent completion rate,
workload, energy and HP. It then adjusts side quests and the challenge, and on busy days protects the core by demoting
lower-priority quests to optional. *Too easy* adds 2 side quests, allows longer ones and rolls rarer challenges.
*Overloaded* keeps one short side quest, and *critical* removes them and the challenge. It never raises real-world
targets automatically (see *Safety*).

## 3. Today Score (0–100)

A weighted average of the parts of the day that apply today. Weights are editable in Admin → Economy.

| Component | Weight | Ratio |
| --- | --- | --- |
| Core quests | 45 | done / total |
| Important quests | 12 | done / total |
| Optional quests | 6 | done / min(2, available). Doing 2 is full marks, so optional quests can only help. |
| Physical | 12 | steps vs targets, blended 50/50 with the workout on training days (a completed workout guarantees ≥ 75%) |
| Nutrition | 7 | calories within ±10% of target + protein vs target (only if nutrition tracking is on) |
| Hydration | 6 | water / daily target |
| Routines | 6 | routine steps done |
| Consistency | 6 | successful days in the last 7 |

Components that don't apply (e.g. physical on a rest day, nutrition when tracking is off) are **dropped and their weight
is redistributed**, so a rest day can still score 100. Achievements unlocked today add +2 each (max +5).
Grades: **S** ≥ 95 · **A** ≥ 80 · **B** ≥ 65 · **C** ≥ 45 · **D** < 45.

## 4. Streaks

- **Daily streak:** a day counts when the score reaches the difficulty threshold (Casual 50 · Normal 60 · **Hard 70** ·
  Insane 80). On a rest day, finishing its (few) core quests is enough.
- **Weekly streak:** 4 successful days a week (Casual/Normal) or 5 (Hard/Insane).
- **Streak Freeze** is used automatically on a failed day. **Sick days** preserve the streak for free.
- **Streak Revive** restores a broken streak within 3 days.
- **Per-activity streaks** (e.g. NoFap days in a row) power mastery achievements.
- Milestones at 3 · 7 · 14 · 30 · 50 · 100 · 150 · 200 · 365 days give coins, HP and a celebration. Each streak day
  also adds +1% XP (max +20%).

## 5. HP, recovery and penalties: never a death spiral

- Completing core quests gives +1 HP (max +10 per day from quests). A perfect core day gives +5, a well-managed rest day
  +6, a streak milestone +5, and recovery activities +2.
- At day close: −3 per missed core quest, −1 per ignored important quest, −4 if 7-day consistency drops below 40%.
  **Total daily loss is capped at 12**, scaled by difficulty (Casual ×0.4 … Insane ×1.4). Sick days lose nothing.
- **HP 0 is a knock-out, not a game over.** Nothing is deleted. You enter **Recovery Mode** at 25 HP: losses ×0.25,
  gains ×2, essentials-only days, and a comeback bonus for strong days. You leave Recovery Mode at 60 HP.
- **Coins:** −5 per missed core quest plus the procrastination fee, **capped at 25 per day** and never below 0.
- **Sluggish:** a score under 40 gives XP ×0.9 the next day. One good day clears it.

Every penalty is game-only. The app never asks you to "pay" with real-world behaviour.

## 6. Energy
Starting energy = 20 + 10.5 × hours slept (unknown sleep → 85), at least 30, +10 on rest days. Costs by difficulty:
3 · 5 · 10 · 20 · 30, plus 1 per extra 10 minutes beyond 20 minutes. Rest/sleep/mental-wellbeing activities *restore*
energy. Low energy makes the generator and the coach suggest lighter options, and at < 20 energy the "Low battery" rule
says to focus on the core only.

## 7. The world (tycoon)
You start in a **Tiny Room** (bedroom level 1). There are 11 rooms, each tied to a life area, with 5 levels and exponential
prices (`baseCost × growth^(level−1)`):

| Room | Base cost | Growth | Unlocks at |
| --- | ---: | ---: | ---: |
| Bedroom | 100 | ×3 | L1 |
| Pet Corner | 120 | ×2.8 | L2 |
| Bathroom | 250 | ×2.8 | L3 |
| Kitchen | 400 | ×2.9 | L4 |
| Gym | 500 | ×3 (500 → 1,500 → 4,500 → …) | L5 |
| Garden | 650 | ×2.8 | L6 |
| Office | 800 | ×2.9 | L7 |
| Library | 1,000 | ×2.9 | L9 |
| Workshop | 1,400 | ×3 | L11 |
| Recreation Room | 1,800 | ×3 | L13 |
| Storage Vault | 2,200 | ×3 | L15 |

Rooms give **world bonuses** (daily coin income, max energy, side-quest slots, +XP% in their category). World income is
paid only for playing: `income × yesterday's score / 100`, and nothing below a score of 30. Home level (the sum of room
levels) unlocks titles from *Tiny Room* to bigger homes. Each room shows visible furniture as it levels up, and you can
buy decorations and cosmetics (avatar hair/skin/outfits/accessories/backgrounds, accent themes).

The first coins go into a **first micro-upgrade** (Cozy Lamp for the bedroom), so the build loop shows up on day 1.

## 8. Real-world rewards
In the Shop you can define treats (a movie night, a new book, a gadget…) with a coin price. The seeded examples start
**unapproved**. Nothing can be redeemed until you approve or create it. Food rewards are a free choice, never framed as
a "cheat day" or as compensation for training.

## 9. Achievements, classes, coach, reviews
- **155 achievements** across first steps, streaks, fitness, strength records, cardio, nutrition, hydration, home, care,
  knowledge, world building, economy, NoFap mastery, screen-time discipline and **16 hidden** ones. They're data-driven
  (counter + threshold), so new ones need no code.
- **Classes emerge** from the last 30 days: Athlete, Builder, Disciplined, Explorer, Guardian, Creator, Survivor or
  Balanced. You never pick one; it describes how you actually play.
- **Coach** (rule-based, no AI): tones Balanced / Serious / Motivational / Ironic / Provocative. It comments on patterns
  ("You complete more quests on Friday"), weak areas, overload and comebacks. Provocative is teasing, never humiliating.
- **Daily recap** (evening) and **weekly review** (Monday) summarise score, XP, coins, streaks, strongest and weakest
  areas, and propose small, approvable changes for next week.

## 10. Difficulty presets

| | Casual | Normal | **Hard** (default) | Insane |
| --- | --- | --- | --- | --- |
| Reward multiplier | ×0.9 | ×1 | ×1.1 | ×1.25 |
| Penalty multiplier | ×0.4 | ×0.7 | ×1 | ×1.4 |
| Streak threshold | 50 | 60 | 70 | 80 |
| Side quests | −1 | ±0 | ±0 | +1 |

## 11. Personal goals

### NoFap (daily core quest)
- "NoFap — stayed clean today" is a **core** daily quest, checked off at night (22:50). It weighs a lot in the score, rewards
  Discipline and has its own streak.
- **Urge-reset side quests** are in the pool (and in the Library, so you can start one the moment an urge hits): leave the
  room and walk 5 min, 15 push-ups, cold water on the face, plus the "phone charges outside the bedroom" habit.
- Mastery achievements at **7 / 30 / 90 / 365** clean days.
- A slip is logged with *Skip*, so it becomes data, not a verdict. The next day starts clean, and a Streak Freeze or
  Revive still works.
- It's marked **private**: notifications and lock-screen text use neutral wording ("Evening check-in").

### Play-time budget: 1h30 per day
- Covers games, TikTok/reels/shorts, YouTube/streaming for fun and social scrolling. **Video calls with your partner never
  count.**
- The **Play time** card on Today (and the full Play Time screen) has a big **Start** button. Pick what you're doing,
  play, then tap **Stop**. The timer is saved on the device, so it keeps counting if you close the app, and sessions that
  cross the day boundary (04:00) are split between the two days. Forgot the timer? Add minutes manually.
- The bar turns amber at 80% and red over the limit. Reminders fire near the limit.
- "Play time under budget" is a **core** quest in `atMost` mode: it's won automatically at day close if you stayed ≤ 90
  min, and fails as soon as you go over. Achievements reward the first day under budget, 7 and 30 days in a row, and 100
  days in total.
- Change the limit in Settings → Targets.

## 12. Safety rules (non-negotiable)

1. **Never incentivise** fasting, skipped meals, extreme calorie restriction, punitive exercise, overtraining or sleep
   deprivation. The AI importer flags such patterns, and the seed content contains none.
2. **Adaptive targets move slowly and need approval.** Steps change by one increment at most (e.g. 6,500 → 6,750) after
   5+ logged days. Calories and protein stay within configurable bounds, weight trends are read over weeks, and
   training load goes up only after clean, easy sessions (at most **+15%** per jump, cardio duration at most **+20%**).
   Every change is a YES/NO card.
3. **Starting values aren't medical advice.** Nutrition defaults (74 kg, 170 cm, 1,800 kcal, 150 g protein, 55 g fat,
   ~175 g carbs, 2–2.5 L water) are editable settings, and the UI says so.
4. **Penalties are capped and game-only**, with Recovery Mode instead of game over.
5. **Rest is part of the game.** Rest days and sick days are first-class, and recovery activities restore energy and HP.
