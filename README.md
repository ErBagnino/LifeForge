# LIFEFORGE

> Your real life is the game.

LifeForge is a personal **Life Tycoon / RPG** built as a mobile-first Progressive Web App for iPhone
(Safari → Add to Home Screen). You complete real-life quests, earn XP, coins and stats, level up,
build your home one room at a time, and review your progress. It's for one player, runs local-first
and has no accounts, backend or social features. Everything stays on the device.

```
real life → quest → XP / coins / stats → level & unlocks → build your world → new quests → review
```

The name lives in a single constant (`src/config/app.ts` → `APP_CONFIG.name`), so renaming the app is a one-line change.

---

## Contents

- [What's inside](#whats-inside)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Install on iPhone](#install-on-iphone-add-to-home-screen)
- [Deploy to Vercel](#deploy-to-vercel)
- [Environment variables](#environment-variables)
- [Push notifications](#push-notifications)
- [Data, backup & privacy](#data-backup--privacy)
- [Project structure](#project-structure)
- [Hidden tools](#hidden-tools)
- [Documentation](#documentation)

---

## What's inside

| Area | Highlights |
| --- | --- |
| **Adapts to your real life** | Nothing is assumed: work hours, wake/bed times, training days and step habits can all be **not set** or **"not sure yet"**, and the app works fine without them. The work schedule supports per-day hours, breaks, partial info ("from 9, end unknown"), variable shifts, versions that start later ("from Monday"), and **one-off days** ("tomorrow 10–20"). A learned **daily capacity** keeps core quests, trims optional ones on full days, and respects "Keep this task", "Keep all" and "Push". |
| **LifeForge Coach** | A chat that configures the game in Italian or English: "Da lunedì lavoro dalle 8 alle 18", "il mercoledì finisco prima", "questa settimana niente palestra", "da ottobre avrò più tempo", "organizzami la giornata". It asks when something is ambiguous, shows a **preview with today's impact**, and changes nothing until you tap APPLY. It runs **on the device**. Voice input where the browser supports it. An optional AI fallback uses your own API key. |
| **Today** | HUD (avatar, level, XP, coins, HP, energy), Today Score 0–100, **Day 1 starts small** (3–5 core objectives), Next Action card, collapsible sections (core, routines, important, optional, nutrition, stats), editable timeline, quick log, play-time timer, a "Working today?" prompt shown only when it would change the plan. |
| **Nutrition** | Calories/macros/water against your targets, meals with photos, 16 quick-add foods with portions, a **food camera** (big Take Photo button, full-width preview), optional AI estimates you review before logging, 7-day charts. |
| **Quests** | Core / important / side / daily challenge / weekly / boss / hidden. Complete, snooze (30 min · 1 h · tonight · tomorrow), reschedule, skip. Warns you when you keep postponing. Algorithmic side-quest generator (no AI API) that knows the time, your energy, workload and history. |
| **Train** | Seeded 3-day plan (Mon Upper A · Wed Lower + Core · Fri Upper B, 60–120 s rest). 37 exercises with animated SVG illustrations and front/back muscle maps. Set logging (weight · reps · done · RPE 😎🙂😰💀 · note). A progression engine that *proposes* the next session and waits for your YES/NO, learns from failures, and never auto-applies. Walk → run cardio plan. |
| **World** | 2D tycoon home with 11 rooms, exponential upgrade prices, world bonuses (income, max energy, XP%), decorations, avatar editor, shop (Streak Freeze, Streak Revive, rerolls, boosters), real-world rewards you approve yourself. |
| **Stats** | Quick & advanced stats, calendar (month / week / day), records, emergent character classes, daily & weekly reviews. |
| **Rules you can edit** | Admin panel: CRUD activities, smart rules, XP/coins economy, score weights, energy costs, tycoon prices, routines, and **Create with AI** (copy a structured prompt → paste JSON → schema validation → preview/edit → import). |
| **Health guardrails** | Never rewards fasting, skipped meals, extreme restriction, punitive exercise or sleep deprivation. Adaptive targets move in small steps, stay within safety bounds, and wait for your approval. Game-only penalties that can't spiral. |
| **Personal goals** | Daily **NoFap** core quest with urge-surfing side quests, private discreet notifications and mastery achievements (7 / 30 / 90 / 365 days). **Play-time budget** of 90 min/day (games, TikTok/reels, YouTube, social), tracked with a start/stop timer that survives closing the app. Video calls with your partner never count. |

Content seeded out of the box: **123 activities**, **155 achievements** (16 hidden), **37 exercises**,
**79 cosmetics**, **11 rooms**, **16 quick-add foods**, 9 cardio stages, morning/night routines and 8 default smart rules.

Designed for **iPhone 15 Pro (393 × 852)** first, and verified with a Playwright audit (`npm run qa`) at 375, 390, 393,
430, 768 and 1440 px and in landscape: zero horizontal overflow, ≥ 44 px touch targets, safe areas (Dynamic Island, home indicator), keyboard-aware
chat and sheets, and light/dark themes.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Motion (Framer Motion) · Zustand · Dexie (IndexedDB) ·
Recharts · date-fns · Zod · React Router · vite-plugin-pwa (custom Workbox service worker) · Vitest.

## Getting started

Requirements: **Node 20+** (22 recommended) and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

To test on your iPhone from a dev machine on the same Wi-Fi:

```bash
npm run dev -- --host   # then open http://<your-computer-ip>:5173 in Safari
```

> Service workers and "Add to Home Screen" need HTTPS (or `localhost`). For a real install on the phone,
> deploy to Vercel (below). It's free, and you don't need a Mac.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-check (`tsc -b`) and build the production bundle + service worker into `dist/`. |
| `npm run preview` | Serve `dist/` locally (use this to test the PWA/offline behaviour). |
| `npm run typecheck` | TypeScript only. |
| `npm run lint` | ESLint (incl. React Hooks rules). |
| `npm test` | Vitest: domain engines, services on fake IndexedDB, full game loop. |
| `npm run check` | typecheck → lint → test → build. Run before every push. |
| `npm run icons` | Regenerate the PNG icons from `scripts/icon.svg.mjs` (needs Playwright/Chromium). |
| `npm run qa` | Mobile audit against `npm run preview`: overflow, clipped controls, < 44 px targets, console errors on every route. `W=375 H=812 npm run qa` for other sizes (needs Playwright/Chromium). |

## Install on iPhone (Add to Home Screen)

1. Open the deployed URL in **Safari** (it has to be Safari; other iOS browsers can't install PWAs on older iOS versions).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch LifeForge from the home screen. It opens full-screen (standalone, portrait) and works offline.
4. Optional: in **Settings → Notifications**, enable reminders. iOS only allows notification permission
   **after** the app has been added to the Home Screen (iOS 16.4+).

Updates: when a new version is deployed, the app shows an "Update available" prompt. Tap it to reload.

## Deploy to Vercel

The repo includes `vercel.json` (SPA rewrites, no-cache headers for `sw.js`/manifest, immutable caching for hashed assets).

**Using the dashboard (no CLI needed):**

1. Push the repo to GitHub.
2. On [vercel.com](https://vercel.com) → **Add New… → Project** → import the repository.
3. Vercel detects Vite. Keep the defaults (build `npm run build`, output `dist`).
4. (Optional) add the push environment variables below.
5. **Deploy**, then open the `https://….vercel.app` URL on your iPhone and add it to the Home Screen.

**Using the CLI:**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

Every push to the production branch redeploys automatically. Your data isn't affected, because it lives in the phone's IndexedDB.

## Environment variables

None are needed. Copy `.env.example` to `.env` only if you want Web Push:

| Variable | Purpose |
| --- | --- |
| `VITE_PUSH_PUBLIC_KEY` | VAPID public key (URL-safe base64). |
| `VITE_PUSH_ENDPOINT` | Base URL of your push backend (see below). |

On Vercel, set them under **Project → Settings → Environment Variables** and redeploy (they're read at build time).

## Push notifications

LifeForge has a `NotificationService` with interchangeable providers:

| Provider | When it's used |
| --- | --- |
| **In-app** | Always available. Toasts/banners while the app is open. |
| **Browser / service worker** | After you grant permission. Uses `registration.showNotification` (required on iOS). The local scheduler fires these only while the app is open or recently backgrounded, which is a PWA limitation. |
| **Web Push** | Only when both env variables are set. Delivers reminders when the app is closed. |
| **Native** | Reserved for a future iOS shell (see `docs/future-ios.md`). |

A **frequency governor** enforces a per-day cap, quiet hours, a minimum gap between reminders and de-duplication
(the evening recap is the only thing allowed through quiet hours). Private quests (e.g. NoFap) always use discreet titles.

### Backend contract (optional)

If you run a push backend, it only needs three endpoints. It receives **no game data**: just the push subscription
and the text/time of the next 24 h of reminders.

```http
POST {VITE_PUSH_ENDPOINT}/subscribe     { "subscription": PushSubscriptionJSON }
POST {VITE_PUSH_ENDPOINT}/unsubscribe   { "endpoint": string }
POST {VITE_PUSH_ENDPOINT}/schedule      { "endpoint": string,
                                          "reminders": [{ "at": epochMs, "title": string, "body": string, "tag": string }] }
```

`/schedule` replaces the previous schedule for that endpoint. A minimal implementation uses a Vercel/Cloudflare
function, a KV store, the [`web-push`](https://www.npmjs.com/package/web-push) library with your VAPID private key,
and a cron that sends reminders whose `at` has passed. The service worker (`src/sw.ts`) already handles `push`
and `notificationclick`, so a tap opens the right screen.

## Data, backup & privacy

- All data lives in **IndexedDB on your device** (database `lifeforge`). Nothing is sent anywhere, and there's no analytics.
- **Optional AI:** only if you add your own Anthropic API key (Settings → Coach & AI). Then, and only then, messages
  the on-device Coach doesn't understand, and food photos you choose to analyze, go directly from your device to
  Anthropic's API. The key stays in this browser only and is never included in backups.
- **Settings → Data → Export** downloads a versioned JSON backup; **Import** validates every table against a schema and
  restores atomically (all or nothing).
- iOS may evict storage from websites you don't use for weeks. Installed Home Screen apps are much safer,
  but **export a backup regularly** anyway. The app requests persistent storage (`navigator.storage.persist`) where supported.
- **Erase everything** is in Settings → Data (asks for confirmation).

## Project structure

```
src/
  config/        app name, version, db name (single source of truth)
  types/         domain types (activities, quests, player, workouts, tycoon, settings…)
  utils/         dates (game day with configurable day start), math, ids, formatting
  domain/        pure, tested game engines: XP/levels, rewards, energy, HP, streaks, score,
                 recurrence, schedule (work/temporary/exceptions), daily capacity & balancing,
                 adaptive difficulty, quest generator, achievements, smart rules, progression,
                 cardio, targets, tycoon, classes, coach lines, Coach language parser (IT/EN)
                 and assistant, profile field statuses, reminders…
  data/          seed content: activities, achievements, exercises, poses, rooms, cosmetics,
                 routines, quest templates, cardio stages, default rules & settings
  repositories/  the only layer that touches Dexie (activity, quest, workout, stats,
                 achievement, tycoon, settings, notification repositories)
  services/      use cases (quest/day/workout/tycoon/metrics/schedule/coach/food…), GameTx unit
                 of work, notifications, export/import, AI import, optional Claude client, haptics, clock
  store/         Zustand store + FX event queue
  components/    UI kit, HUD, tab bar, sheets, charts, SVG illustrations, FX layer
  features/      screens: today, quests, train, world, stats, review, profile, play, coach,
                 nutrition (+ food camera), settings, admin, onboarding, search, dev
  sw.ts          service worker (precache, SPA navigation, push, notification click)
docs/            architecture, game design, database, progression, future iOS
```

## Hidden tools

- **Developer toolbox:** Settings → tap the version line 7 times. You get time travel (shift days/hours), simulate a
  day/week/workout, reset the day, complete/fail random quests, grant XP/coins, unlock achievements, test a notification,
  preview the level-up FX, and inspect raw IndexedDB tables.
- **Admin panel:** Settings → Admin. Edit every activity, rule, reward, penalty, score weight, energy cost and price.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): layers, data flow, transactions, service worker, testing.
- [`docs/game-design.md`](docs/game-design.md): core loop, quest types, score, HP/energy, streaks, world, safety rules.
- [`docs/database.md`](docs/database.md): IndexedDB schema, indexes, migrations, export format.
- [`docs/progression.md`](docs/progression.md): XP & level curves, economy, training/cardio/step progression, adaptive difficulty.
- [`docs/future-ios.md`](docs/future-ios.md): HealthKit, Live Activities, Dynamic Island, Apple Watch and native-shell options.
