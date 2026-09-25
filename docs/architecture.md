# Architecture

LifeForge is a **local-first single-page PWA**. The browser holds everything: code (precached by the service worker)
and data (IndexedDB). There is no server in the core loop, and the optional push backend only ever sees reminder text.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  features/*  (screens)         components/*  (UI kit, HUD, FX, charts, SVG)  │
│        │  read: useGame selectors, useAsync(repository…)                     │
│        │  write: useGame.act(service())                                      │
├────────▼─────────────────────────────────────────────────────────────────────┤
│  store/gameStore.ts  (Zustand)                                               │
│  status · player · settings · buildings · today{quests,long,log,plan}        │
│  suggestions · leisureTimer · fx queue · act() · refresh()                   │
├────────▼─────────────────────────────────────────────────────────────────────┤
│  services/*  (use cases)                                                     │
│  questService · dayService · workoutService · metricsService · tycoonService │
│  scheduleService · coachService · foodService · goalService · suggestions    │
│  insightsService · export/aiImport/admin · ai/claude (optional)              │
│  GameTx (unit of work) · notifications · haptics · clock                     │
├────────▼──────────────────────────────┬──────────────────────────────────────┤
│  domain/*  (pure functions, tested)   │  repositories/*  (only Dexie users)  │
│  level · rewards · energy · hp ·      │  activity · quest · workout · stats  │
│  streak · score · recurrence ·        │  achievement · tycoon · settings ·   │
│  schedule · capacity · adaptive ·     │  notification  (+ player/meta/       │
│  questGenerator · nlu · coachAssistant│                                      │
│  achievements · rulesEngine ·         │  suggestion helpers)                 │
│  progression · cardio · targets ·     ├──────────────────────────────────────┤
│  tycoon · classes · coach · reminders │  repositories/db.ts: LifeForgeDB     │
│  leisure · dayClose · nextAction …    │  (Dexie 4 → IndexedDB "lifeforge")   │
└───────────────────────────────────────┴──────────────────────────────────────┘
```

## Layers

### `domain/`: pure game logic
No React, no Dexie, no `Date.now()` (time is passed in). Each engine takes plain data plus the relevant slice of
`GameRules` and returns plain data. That keeps the rules deterministic, testable, and editable from the Admin panel.
Examples:

- `computeQuestValues(input, level, rules)` → `{ xp, coins, energyCost }`
- `computeScore(input, rules.score)` → a breakdown with per-component ratios, redistributing weights of components that don't apply
- `suggestProgression(input)` → an `increase | increase_reps | maintain | decrease | deload | none` suggestion with a reason
- `generateSideQuests(ctx)` → seeded-random, weighted picks honouring time, energy, workload, recency and rarity
- `evaluateRules(rules, trigger, facts)` → smart-rule actions to apply

### `repositories/`: persistence boundary
The only code that imports Dexie. Every table has a small repository (`base.ts` provides `get/put/bulkPut/delete/all`)
plus query helpers (`questRepository.byDate`, `statsRepository.aggregateMetrics`, …). Swapping IndexedDB for a sync layer
or a native store later means replacing this folder only.

### `services/`: use cases
Services orchestrate domain engines and repositories. Every write that affects the game state goes through a
**`GameTx`** unit of work:

```ts
return withTransaction(async () => {          // one Dexie rw transaction over all tables
  const tx = await GameTx.open(date);         // loads player, settings, buildings, day log, counters
  tx.addXp(q.xp, 'quest'); tx.addCoins(q.coins, 'quest'); tx.applyEnergy(-q.energyCost);
  tx.inc({ [C.questsCompleted]: 1 });
  await tx.checkAchievements();               // data-driven, counter-based
  await tx.commit();                          // writes player, log, ledger, counters (sequentially)
  return { events: tx.events };               // questComplete, levelUp, achievement, …
});
```

Rules that keep the transaction healthy:

- **Never await non-Dexie promises inside `withTransaction`** (no `fetch`, no dynamic `import()`, no timers). IndexedDB
  auto-commits when the microtask queue drains, and Dexie's zone would be lost. Services use static imports only.
- Counter writes are sequential inside `commit()` to avoid lost updates.
- Day-level operations (`ensureToday`, `startWorkout`) have in-memory locks so double taps and StrictMode double-effects
  can't create duplicate days or sessions.

### `store/`: UI state and feedback
`useGame` (Zustand) holds a denormalised snapshot for the screens. The one entry point for mutations is:

```ts
await act(completeQuest(id));   // runs the service → refresh() → haptics → queue FX events → reschedule reminders
```

Events (`GameEvent` union in `services/events.ts`) feed `components/fx/FxLayer.tsx`: toasts, flying XP particles towards the
HUD bar, level-up / achievement / building overlays and streak celebrations. Screens that need history use
`useAsync(() => repository.query(), deps)`, which re-runs automatically when the store `version` changes.

### `features/` and `components/`
Screens are lazy-loaded routes (`app/App.tsx`). Components never call Dexie directly. Shared UI lives in
`components/ui` (Card, Button, Sheet, forms, progress rings), game UI in `components/game` and `components/layout`
(HUD, tab bar, screen shell, error boundary), charts in `components/charts`, and the exercise art in
`components/illustration` (forward-kinematics skeleton + props + muscle map, all SVG).

## Time: the game day
`utils/date.ts` defines a **game date**: a day starts at `settings.schedule.dayStartHour` (default 04:00), so a 01:30
bedtime still belongs to "yesterday". `services/clock.ts` wraps `Date.now()` with an offset used by the dev toolbox's time
travel. Everything calls `clock.now()` / `clock.today()`.

**Day lifecycle** (`dayService`):

1. `ensureToday()` runs at boot and on resume. If the stored day is older than today, it closes every missing day (score,
   streak, HP, penalties with caps, world income, achievements, weekly/boss settlement) and then starts today.
2. `startDay()` resolves the day plan (regular week → temporary override), instantiates due activities (recurrence
   spreading, workday awareness, flexible training when availability is unknown, no-gym exceptions), applies the
   **first-week ramp** (Day 1 = up to 4 core objectives + the first quest), computes the **daily capacity**, balances
   quests by priority (core stays, important fills the remaining room, the rest becomes a no-pressure bonus unless
   the player kept it), picks the adaptive state, then adds side quests sized to the leftover capacity, the daily
   challenge, the hidden quest and weekly/boss quests. `rebuildDay()` re-runs the same balancing on existing quests
   whenever the schedule changes.
3. During the day, quests move through `pending → completed | skipped | failed | snoozed`. Smart rules run on
   `quest_completed`, `workout_completed`, `check` and `day_start/day_end` triggers.
4. `closeDay()` settles the day. `atMost` metric quests (e.g. play time ≤ 90 min) are auto-won if the limit held.

## Schedules, capacity and the player's control
- `domain/schedule.ts`: the work model (`WorkSettings` with versioned `WorkSchedule`s; each weekday is `off`,
  `unknown` or `work` with *optional* start/end/break/duration/approximate). `resolveWork(date)` only **derives**: start
  + duration gives an end, start alone stays partial. A temporary `DayPlan` (`temporary: true`) overrides a single date.
  Exceptions (`no_gym`, `more_time`, `less_time`, `keep_all`, `push`) are time-boxed and drive `loadModeFor(date)` and
  `capacityAdjustment(date)`. `migrateWork()` turns the old assumed Mon–Fri 09–19 default into "not set".
- `domain/capacity.ts`: `computeCapacity()` blends known free time × a learned share of free time actually used
  with the minutes usually completed on similar days (work / free / unknown). It then applies energy, recent
  completion and more/less-time periods. `balanceLoad()` does the priority fit. `rampLimits()` defines the first week.
- `services/game/load.ts` gathers history (`capacityHistory`) and applies the decisions, remembering `baseTier` so a
  rebalance can restore quests. A player override (`kept`) is never demoted again.
- `services/scheduleService.ts`: every availability change (schedule versions, one-off days, exceptions, load mode,
  training days, "not sure yet") saves settings and rebalances today. `previewRebalance(settings, date, plan?)`
  computes the effect of hypothetical settings without writing, and powers the Coach's impact preview.
- Missing info is modelled explicitly: `Settings.known` holds `set | not_set | unknown` per field, and
  `domain/profile.ts` presents fields as SET / NOT SET / OPTIONAL. Nothing treats a missing value as an error.

## Coach (configuration assistant)
```
text ─► domain/nlu.ts (normalize → days/scope/times/numbers → Intent[])
     ─► domain/coachAssistant.ts respond(): reply | question (+ quick replies, pending state) | Proposal(ConfigChange[])
     ─► services/coachService.ts: impact preview (previewRebalance) → APPLY → applyChanges() → schedule/settings services
```
- Deterministic and on-device (Italian + English). It never invents: a start without an end stays partial, and
  ambiguous scope ("lavoro 9–18" with no date) triggers a question with quick replies.
- Proposals are data (`ConfigChange` union). Nothing is written until APPLY. "sì" confirms, and "no" / "non mi va" /
  "lascia tutto com'è" dismiss. Chat history lives in `meta.coachChat`.
- Optional fallback: `services/ai/claude.ts` makes one forced tool call to the Messages API with the player's own key (stored
  in localStorage, excluded from backups). The output is validated with Zod against the same `ConfigChange` schema
  and still shown as a proposal. Food photos use the same client with a `log_meal` tool. Models are listed from the API,
  never hard-coded.

## Notifications
`services/notifications/NotificationService.ts` exposes providers (`inapp`, `browser`, `webpush`, reserved `native`).
`reminderScheduler.ts` builds today's reminder plan from `domain/reminders.ts` (quests, routines, water, workout,
streak-at-risk, leisure budget, recap). The plan passes through the governor (quiet hours, daily cap, min gap, dedupe),
then:

- while the app is open → `setTimeout` + in-app banner / SW notification;
- if Web Push is configured → the next 24 h are synced to the backend (`/schedule`), which pushes even when the app is closed.

Private quests (tag `private`, e.g. NoFap) always get neutral titles like "Evening check-in".

## PWA / service worker
- `vite-plugin-pwa` in **injectManifest** mode compiles `src/sw.ts`: Workbox precache of the build, SPA navigation fallback
  to `index.html`, `push` and `notificationclick` handlers (focus an open window or open the target URL).
- Manifest values come from `APP_CONFIG` (`vite.config.ts`): `id`, `name`, `short_name`, `display: standalone`,
  `orientation: portrait`, `theme_color`, `background_color`, 192/512/maskable icons. `index.html` adds the iOS meta tags,
  `apple-touch-icon`, `viewport-fit=cover`, and a pre-paint theme script to avoid a light flash in dark mode.
- `app/pwa.ts` registers the SW with a prompt: new versions show "Update available" instead of reloading under your fingers.
  An hourly `registration.update()` catches deploys while the app stays open.

## Error handling & states
- `ErrorBoundary` wraps the app shell and, keyed by path, every route, so a crashing screen doesn't take down navigation.
- Boot is a state machine (`booting → onboarding | ready | error`). If IndexedDB can't be opened (private browsing, blocked
  storage), the error screen explains why and offers a retry.
- All user input (activity editor, AI import, backup import, settings) goes through Zod schemas.
- Screens render explicit **loading** (skeletons), **empty** (EmptyState with a next step) and **offline** (banner via
  `useOnline`) states.

## Mobile layout: safe areas, keyboard, widths
- Safe areas come from `env(safe-area-inset-*)` via CSS variables (`--safe-top/bottom/left/right`): the HUD, sticky
  headers, tab bar, sheets and full-screen views pad for the Dynamic Island and home indicator.
- `useKeyboardInset()` tracks the iOS visual viewport and publishes `--kb`, `--vvh` and `--vvtop`, plus `html.kb-open`.
  The tab bar hides while typing, sheets lift above the keyboard, footers use `.pb-kb`, and the Coach sizes itself to the
  visible area so the composer stays above the keyboard.
- Content is a centred column (max 640 px) on tablets and desktop. Screens are designed at 393 × 852 first.
- Touch targets are ≥ 44 px. Compact controls (segmented tabs, switches, 7-day grids) keep their visual size and get a
  44 × 44 hit area through the `.hit-44` utility.
- Progressive disclosure: Today uses `Collapsible` sections whose open state is remembered per device.

## Accessibility & performance
- Semantic buttons/tabs/dialogs, `aria-label`s on icon buttons, visible focus rings, 44 pt touch targets, and Dynamic Type
  friendly sizes. `prefers-reduced-motion` disables particles and big transitions. Charts have a table view.
- Route-level code splitting plus manual chunks (`react`, `motion`, `dexie`, `charts`), so Recharts loads only on stats screens.
- Store selectors are narrow. Timers (`useNow`) tick only on screens that need them.

## Testing
`vitest` with `fake-indexeddb`:

- `src/domain/__tests__/*`: engines: level curve, XP/coins/energy, HP caps & recovery, streaks (freeze, revive, sick day),
  score redistribution, recurrence, day close, workload, adaptive caps, quest generator budget, next action, smart rules,
  reminders + governor, snooze & habit learning, progression (incl. the 20 kg → 22.5 kg spec example), cardio, adaptive
  targets, achievements, tycoon economy, classes, records, goals, play-time budget, work schedule resolution &
  migration, daily capacity (Day A/B/C example), priority balancing & overrides, first-week ramp, Coach language
  parser (every example sentence of the spec, IT + EN), Coach assistant flows (questions, proposals, merges).
- `src/services/__tests__/gameLoop.test.ts`: the real services on a fresh fake IndexedDB: seeding and the first day, first
  quest (XP, coins, FIRST BLOOD, first upgrade funded), undo, metric-driven quests, play-time timer and day-close win/fail,
  snooze/skip, day rollover with streak, rest day, workout session → progression suggestion, tycoon blockers, export →
  validate → import round-trip, and AI import parsing/validation/unsafe-pattern warnings, Day 1 ramp, running with no
  work schedule, temporary vs recurring schedules, "Keep this task" surviving a rebalance, meals.
- `src/services/__tests__/coach.test.ts`: the Coach end to end (preview with impact → APPLY, "sì" confirms, dismiss,
  plan-my-day flow, optional AI fallback with a mocked API and schema validation).
- `npm run qa` (`scripts/qa/audit.cjs`) runs Playwright against the preview build with simulated safe areas. It
  onboards a fresh player and, on every route, checks zero horizontal overflow, no clipped controls, ≥ 44 px targets
  and no console errors. It was run at 375/390/393/430/768/1440 px and 852×393 landscape, plus screenshot reviews in
  light and dark mode.

Run everything with `npm run check`.
