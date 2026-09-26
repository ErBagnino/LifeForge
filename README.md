# LIFEFORGE

> Your real life is the game.

LifeForge is a personal **Life Tycoon / RPG** built as a mobile-first Progressive Web App for iPhone
(Safari → Add to Home Screen). You complete real-life quests, earn XP, coins and stats, level up,
build your home one room at a time, and review your progress. It's for one player, runs local-first
and has no accounts or social features. Game data stays on the device. An **optional AI Coach and food
photo estimates** use Google Gemini through a small serverless API (your key stays on the server), and
everything keeps working without it.

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
- [AI Coach with Gemini (optional)](#ai-coach-with-gemini-optional)
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
| **AI Coach (Gemini)** | A real agent with ~60 tools: it reads your game (quests, nutrition, workouts, schedule, rules…) and proposes changes: one-time vs recurring activities, goals, achievements, targets, workout edits, routines, schedule, game rules, resets. **Every change is validated and shown as a before → after preview**; nothing is written until you tap APPLY (APPLY ALL for several), and every applied change has **Undo**. Resets need a strong confirmation (typed `RESET EVERYTHING` for a full wipe). Quick actions (complete/skip) apply directly with Undo. Personalities: Gentle, Balanced, Direct (default), Hard. Photos in chat, voice input, a global **Ask LifeForge 🎙️** button. |
| **Basic coach (no AI)** | Without Gemini (not set up, offline, quota reached) the on-device coach still configures schedule, availability, goals, targets, one-time/recurring activities and resets in Italian or English — with the same previews and Undo. |
| **Today** | HUD (avatar, level, XP, coins, HP, energy), Today Score 0–100, **Day 1 starts small** (3–5 core objectives), Next Action card, collapsible sections (core, routines, important, optional, nutrition, stats), editable timeline, quick log, play-time timer, a "Working today?" prompt shown only when it would change the plan. |
| **Nutrition** (tab) | Calories/macros/water against your targets, 16 quick-add foods with portions, 7-day charts. **SCAN FOOD**: take or choose a photo → Gemini returns a structured estimate (foods, approximate quantities, cooking method, confidence, assumptions) → it asks about what it can't see (oil, sauces) with quick buttons → correct it by text or voice ("it was turkey", "200 g rice") with a before → after diff and "why so many calories?" → **REVIEW MEAL** (edit anything; totals are recomputed locally) → **ADD TO TODAY**. Meals from photos are labelled **AI ESTIMATE**. Photos are not stored unless you turn on *Save Food Photos* (off by default). |
| **Quests** | Core / important / side / daily challenge / weekly / boss / hidden. Complete, snooze (30 min · 1 h · tonight · tomorrow), reschedule, skip. Warns you when you keep postponing. Algorithmic side-quest generator (no AI API) that knows the time, your energy, workload and history. |
| **Train** | Seeded 3-day plan (Mon Upper A · Wed Lower + Core · Fri Upper B, 60–120 s rest). 37 exercises with animated SVG illustrations and front/back muscle maps. Set logging (weight · reps · done · RPE 😎🙂😰💀 · note). A progression engine that *proposes* the next session and waits for your YES/NO, learns from failures, and never auto-applies. Walk → run cardio plan. |
| **World** | 2D tycoon home with 11 rooms, exponential upgrade prices, world bonuses (income, max energy, XP%), decorations, avatar editor, shop (Streak Freeze, Streak Revive, rerolls, boosters), real-world rewards you approve yourself. |
| **Stats** | Quick & advanced stats, calendar (month / week / day), records, emergent character classes, daily & weekly reviews (HUD 📊 button). |
| **Help** | Interactive spotlight tour over the real screens (Home, Quests, Train, Nutrition, World, Stats, Coach, Admin), replay in Settings → Help, and ⓘ explanations for Energy, HP, Today Score and more. |
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
Recharts · date-fns · Zod · React Router · vite-plugin-pwa (custom Workbox service worker) · Vitest ·
Google GenAI SDK (`@google/genai`, server side only) · Vercel Functions.

## Getting started

Requirements: **Node 20+** (22 recommended) and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` also serves the AI API (`/api/ai`, `/api/food`, `/api/status`) from the same files Vercel uses.
To try Gemini locally, put `GEMINI_API_KEY=…` in `.env.local` (git-ignored) and restart. Without it the app
runs normally with the basic coach. (`npm run preview` serves only static files, so there the AI shows as
"not connected".)

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
| `npm test` | Vitest: domain engines, services on fake IndexedDB, full game loop, AI tools/orchestrator, serverless handlers (with an injected test client — no network). |
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

The repo includes `vercel.json` (SPA rewrites that leave `/api/*` alone, serverless function settings, no-cache headers for `sw.js`/manifest, immutable caching for hashed assets). The files in `api/` become Vercel Functions automatically — no server to run.

**Using the dashboard (no CLI needed):**

1. Push the repo to GitHub.
2. On [vercel.com](https://vercel.com) → **Add New… → Project** → import the repository.
3. Vercel detects Vite. Keep the defaults (build `npm run build`, output `dist`).
4. (Optional) add `GEMINI_API_KEY` (see [AI Coach with Gemini](#ai-coach-with-gemini-optional)) and the push variables below.
5. **Deploy**, then open the `https://….vercel.app` URL on your iPhone and add it to the Home Screen.

**Using the CLI:**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

Every push to the production branch redeploys automatically. Your data isn't affected, because it lives in the phone's IndexedDB.

## Environment variables

None are required. See `.env.example` (never commit real values: use `.env.local` locally and Vercel's
Environment Variables in production).

| Variable | Where it's used | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | **Server only** (`api/*`) | Gemini API key for the AI Coach and food photos. Never exposed to the browser. |
| `GEMINI_MODEL` | Server only | Optional model override. Default `gemini-flash-latest` (Google's alias for the current Flash model: multimodal, Free Tier). |
| `VITE_PUSH_PUBLIC_KEY` | Client (build time) | VAPID public key (URL-safe base64). |
| `VITE_PUSH_ENDPOINT` | Client (build time) | Base URL of your push backend (see below). |

On Vercel, set them under **Project → Settings → Environment Variables** and **redeploy**.

## AI Coach with Gemini (optional)

LifeForge talks to Gemini only through its own serverless functions:

```
app (browser) ──► /api/ai · /api/food · /api/status  (Vercel Functions, Node)
                      │  validates & size-limits payloads, maps errors, logs nothing personal
                      └─► Google Gemini API  (key from process.env.GEMINI_API_KEY)
```

The key **only** exists as a Vercel Environment Variable. It is not in the React app, the JS bundle, HTML,
localStorage, IndexedDB, backups or git.

### Set it up (≈ 5 minutes, €0)

1. Open [Google AI Studio](https://aistudio.google.com/) and sign in.
2. **Use a Gemini API key from a Google AI Studio Free Tier project**: *Get API key → Create API key*.
3. **Do not enable paid billing if you want to keep this at €0.** A project without billing stays on the Free Tier.
4. Vercel → your project → **Settings → Environment Variables** → add `GEMINI_API_KEY` (Production, and Preview if you want).
5. Optional: `GEMINI_MODEL` (e.g. another Flash model name shown in AI Studio). Leave empty for `gemini-flash-latest`.
6. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables are read by new deployments only.
7. In the app: **Settings → AI → TEST CONNECTION** → it should say **CONNECTED**.

**Free Tier caveats.** Free Tier limits (requests per minute, tokens per minute, requests per day) differ per
model and **can change at any time**; Google AI Studio shows the current ones. Free Tier usage may be used by
Google to improve its products — see Google's terms. When a limit is hit, the app shows *"Gemini is temporarily
unavailable because a usage limit has been reached."* with **USE BASIC COACH** / **VIEW USAGE**; nothing breaks
and nothing is lost.

### Usage monitor

Settings → AI → **Gemini Usage** counts every request LifeForge makes (timestamp, model, type, input/output
tokens reported by Gemini, status, latency, image yes/no — never message content) and shows Today / Last 24 h /
This week / This month, requests in the last minute, requests/day and the share of food scans.
These are **app estimates** for this device. The Gemini API doesn't expose remaining quota, so the app never
shows a quota percentage unless you copy your limits (RPM / TPM / RPD) from AI Studio into Settings → AI;
warning thresholds (70 / 85 / 95 % by default) are configurable. When Google returns a 429, the details Google
includes (which limit, its value, retry delay) are shown as **Google authoritative**. The official source is
**Google AI Studio → Dashboard → Usage** (*View official Gemini usage*).

To save quota the app keeps prompts and context compact, limits response length, never re-sends the photo for
corrections (only the estimate JSON), deduplicates and caches repeated food requests, and computes all numbers
(XP, totals, score) locally.

### How the agent works

`Gemini function call → zod validation (shared schema) → preview (before → after) → your confirmation →
existing game services (GameTx) → structured result → Gemini → final reply.` Read tools run automatically;
complete/skip apply with Undo; writes need APPLY; destructive resets need a strong confirmation and are not
undoable (export a backup first). The model may only say something was done if the tool result says
`success: true`. Changes are snapshotted for Undo (`aiChanges` table).

### Test it

- `npm test` covers the handlers with an injected fake client (missing key, invalid key, quota, model errors,
  payload limits, schema-validated food output), the tool registry, the orchestrator loop and the usage estimator.
- Locally: `.env.local` with a real key → `npm run dev` → Settings → AI → TEST CONNECTION.
- Deployed: `https://<your-app>.vercel.app/api/status` returns `{"state":"connected",…}` (or `not_configured`).

### Troubleshooting

| What you see | Fix |
| --- | --- |
| **NOT CONNECTED** / "Add GEMINI_API_KEY in Vercel and redeploy" | The function has no key: add it and redeploy. On `npm run preview` the API doesn't exist — use `npm run dev` or Vercel. |
| **INVALID KEY** / "Gemini connection failed. Check your API key." | Re-copy the key from AI Studio (no spaces), make sure the Gemini API is enabled for that project, redeploy. |
| **QUOTA EXCEEDED** / "usage limit has been reached" | Wait (per-minute limits clear in about a minute; daily ones reset once a day) or use the basic coach. Check AI Studio → Usage. Don't enable billing if you want €0. |
| "Selected Gemini model unavailable. Check GEMINI_MODEL." | Remove `GEMINI_MODEL` (uses `gemini-flash-latest`) or set a model name listed in AI Studio. |
| "Couldn't analyze this image." | Retake with good light and the whole plate, or add the meal manually. |
| **SERVER ERROR** / "AI service unavailable." | Temporary problem at Google or Vercel — try again; the basic coach keeps working. |

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

- **LOCAL DATA:** all game data lives in **IndexedDB on your device** (database `lifeforge`): quests, logs, meals,
  settings, chat, AI usage stats and the change log. No analytics, no accounts.
- **GEMINI AI (optional):** when you use the AI Coach or Food Vision, your message, a compact summary of your game
  and any photo you attach are sent through LifeForge's serverless API to Google's Gemini API. Photos are never stored
  on the server, and on the device only if *Save Food Photos* is on (off by default). The API key is server-only.
  LifeForge is **not** "100 % on-device" when you use these features — Settings → AI explains exactly what is sent.
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
  services/      use cases (quest/day/workout/tycoon/metrics/schedule/coach/food/reset…), GameTx unit
                 of work, notifications, export/import, AI import, haptics, clock
    ai/          Gemini client (fetch → /api), orchestrator (tool loop), tool registry (read/write
                 tools, previews), change log + undo, context builder, usage tracking
  ai/shared/     zod schemas shared by app and server: tool catalogue, food estimate
api/             Vercel Functions: ai.ts, food.ts, status.ts (thin wrappers)
server/ai/       handlers (validation, size limits, Gemini calls), prompts, error mapping, config
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
