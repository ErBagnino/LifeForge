# Database

LifeForge stores everything in **IndexedDB** through **Dexie 4**. The database is named `lifeforge`
(`APP_CONFIG.dbName`) and is defined in `src/repositories/db.ts`, the only file that knows about Dexie.
Types live in `src/types/*`.

## Tables

| Table | Primary key | Indexes | Contents |
| --- | --- | --- | --- |
| `meta` | `key` | | Key/value: `seedVersion`, `currentDate` (last started game day), `adventureStart` (Day 1, drives the first-week ramp), `leisureTimer` (running play-time timer), `coachChat` (Coach history, pending question, short Gemini transcript, paused AI turn), `tutorial` (tour done), `workSession` (open START WORK timer `{start}`), `lastVisitDate` / `previousVisitDate` (for "Welcome back"). |
| `player` | `id` | | Single row `"me"`: xp, coins, hp, energy, stats, streak state, inventory (freezes, revives, rerolls), boosts, status effects, recovery mode, avatar, unlocked features. |
| `settings` | `id` | | Single row `"settings"`: profile (goals, focus, optional future goals), rhythm (wake/sleep, busy blocks, training availability), **work** (`status` + versioned `schedules`, every day `off`/`unknown`/`work` with optional start/end/break/duration/approximate), **known** (`set`/`not_set`/`unknown` per field), **exceptions** (no gym, more/less time, keep-all, push, time-boxed), **load** mode, **coach** (voice language, voice on/off, personality, AI toggles: Gemini, Food Vision, Save Food Photos, usage tracking, optional limits and thresholds — never an API key), body & nutrition, steps, hydration, leisure budget, safety bounds, notifications, appearance, difficulty, the editable `rules`, and `schemaVersion`. Normalised on read. |
| `activities` | `id` | `category, tier, active` | The activity library (123 seeded): tier, recurrence, difficulty, duration, time of day, metric & mode, stats, tags, scalability. Editable in Admin. |
| `routines` | `id` | | Morning/night routines: ordered activity ids, time, bonus. |
| `quests` | `id` | `date, endDate, kind, status, activityId, [date+kind], [activityId+date]` | Quest instances per game day (plus multi-day weekly/boss quests with `endDate`). Stores status, progress, snoozes, `earned` (for undo/history), reason, `private`, `lightened`, `baseTier` (tier before balancing) and `kept` ("Keep this task"). |
| `dayLogs` | `date` | | One row per game day: score breakdown, metrics totals, load score & level, adaptive state, **capacityMin / plannedMin / completedMin / freeMin / workStatus** (the history the capacity engine learns from), `dayIndex`, energy/HP deltas, streak event, penalties, rules fired, routines done, `closed` flag. |
| `dayPlans` | `date` | | Per-day plan edits. `temporary: true` marks a **one-off schedule** ("tomorrow 10–20") that decides work for that date, with `workStatus` (`set`/`partial`/`unknown`/`off`), optional `workStart`/`workEnd`/`workMinutes`/`breakMin`/`workApproximate`. Other saved plans only carry busy blocks, wake/sleep and rest day, and work follows the regular week. |
| `metrics` | `id` | `date, type, refId, [date+type], [type+date]` | Raw entries: steps, distance, water, calories, protein, carbs, fat, weight, sleep, workout minutes, **leisure** (play-time minutes, `note` = kind)… with `source` (`manual`/`timer`/`health`/`import`) and `refId` linking macro entries to their meal. |
| `exercises` | `id` | | Exercise database (37 seeded): muscles, equipment, cues, illustration id, rep ranges, progression rule. |
| `plans` | `id` | | Workout plans (seeded 3-day Upper A / Lower + Core / Upper B). |
| `sessions` | `id` | `date, status, templateId` | Workout sessions with per-set logs (weight, reps, completed, RPE, note) and cardio entries. |
| `exerciseStates` | `exerciseId` | | Current working weight / rep range per exercise, pending progression suggestion. |
| `achievements` | `id` | `category, unlockedAt` | Definitions (counter + threshold, tier, hidden) and unlock timestamps. |
| `records` | `id` | `kind` | Personal records (exercise weight/reps/volume, steps per day/week, longest streak, best score, most quests in a day). |
| `counters` | `key` | | Lifetime counters that drive achievements (`quests.completed`, `actStreak.nofap`, `leisure.underRunBest`, …). |
| `buildings` | `id` | | The 11 rooms: level, max level, base cost, growth, unlock level, bonuses per level. |
| `cosmetics` | `id` | `type` | Avatar parts, decorations, themes: price, owned, equipped. |
| `rewards` | `id` | | Real-world rewards you define: kind, cost, `approved`, cooldown, redemption count. |
| `redemptions` | `id` | `ts` | Reward redemption history. |
| `suggestions` | `id` | `key, status, type` | Pending YES/NO proposals (weight increase, step target, calories, time changes, deload, cardio stage…). `key` de-duplicates. |
| `notifications` | `id` | `scheduledAt, tag, status` | Reminder log used by the frequency governor (sent, dismissed, per-day counts). |
| `ledger` | `id` | `date, ts` | Every XP/coin/HP change with reason and source id, for the economy history and audits. |
| `meals` | `id` | `date, ts` | Logged meals: name, items (name, grams, kcal, protein, carbs, fat), totals, optional small JPEG photo (≈320 px data URL, only when *Save Food Photos* is on), `source` (`manual`/`preset`/`photo`/`ai`), `estimate` (confidence, corrected, edited) for AI estimates. Deleting a meal removes its metric entries. |
| `aiUsage` | `id` | `ts, type` | *(v3)* One row per Gemini request made by the app: timestamp, model, type (chat, food analyze/revise/explain, status test), input/output/total tokens as reported, ok, HTTP status, error kind, latency, image yes/no, Google quota details on 429. No content. Kept 45 days. |
| `dayContexts` | `date` | | *(v4)* One row per game day with the facts the player gave: `firstOpenAt`, `wakeUpTime` + `wakeSource` (`confirmed` / `estimated` / `manual`), `wakeAskedAt` (NOT YET), `dayStartedAt` (START DAY), `work[]` sessions `{start, end, minutes, edited}` (a session belongs to the day it started on), `noWork`. States, priorities and time budget are computed, never stored. No location data. |
| `aiChanges` | `id` | `ts` | *(v3)* Coach change log: tool, summary, source (gemini/rules), undo data (record snapshots or `uncomplete`), `undoneAt`. Last 60 kept. |

Compound indexes serve the hot paths: `[date+kind]` (today's board by kind), `[activityId+date]` (per-activity history
and streaks), `[date+type]` / `[type+date]` (daily metric totals and trends).

## Access patterns

- **Repositories only.** `src/repositories/*Repository.ts` wrap tables (`base.ts` provides CRUD helpers). Services never
  import Dexie.
- **Atomic writes.** `withTransaction(fn)` opens one read-write transaction over all tables. `GameTx` batches the player,
  day log, ledger, counters and achievements, so a quest completion is all-or-nothing.
- **Transaction hygiene.** Inside `withTransaction`, only Dexie operations may be awaited: no `fetch`, timers or
  dynamic `import()`. Otherwise IndexedDB auto-commits early and Dexie loses its transaction zone.
- **Derived data isn't stored twice.** Aggregates (weekly averages, category balance, trends) are computed from `dayLogs`
  and `metrics` by `statsRepository` / `insightsService`.

## Seeding and upgrades

`services/seedService.ts → ensureSeeded()` runs at boot:

- On first run it creates default settings, the player, and all seed content (the bedroom is pre-built, starter cosmetics equipped).
- When `SEED_VERSION` increases (new activities, achievements, exercises, rooms, cosmetics), it **merges missing ids only**.
  Your edits and progress are never overwritten.
- `settingsRepository.get()` deep-fills missing settings fields from defaults (`normalizeSettings`), so adding a setting
  needs no migration.

**Schema changes** use Dexie versioning. Version 2 added the `meals` table and a `refId` index on `metrics`, version 3
the `aiUsage` and `aiChanges` tables, and **version 4** (current) the `dayContexts` table. Future changes add
`this.version(5).stores({...}).upgrade(tx => …)` in `db.ts` and keep earlier versions intact.
Dexie upgrades existing installs in place on the next launch.

**Settings migrations** use `settings.schemaVersion` (currently 2, applied once at boot by `settingsRepository.migrate()`).
v1 → v2 moved work out of the weekly schedule into `work`. The old built-in default (Mon–Fri 09:00–19:00, an
assumption) becomes **not set**, and a schedule the player had customised is kept as a real schedule version. For
players who had onboarded, `known` fields are marked as set.

## Backup format (export / import)

**Settings → Data → Export** downloads `lifeforge-backup-YYYY-MM-DD.json`:

```json
{
  "app": "LIFEFORGE",
  "format": 1,
  "exportedAt": "2026-09-25T18:00:00.000Z",
  "dbVersion": 1,
  "data": {
    "player": [ … ],
    "settings": [ … ],
    "activities": [ … ],
    "quests": [ … ],
    "…": "one array per table"
  }
}
```

**Import** (`exportService.validateImport` → `importData`):

1. Checks the envelope (`app`, `format`, `data`) and refuses files from a newer `format`.
2. Validates **every table** with its Zod schema (`TABLE_SCHEMAS`) and reports the first issue per table with its path.
3. Requires `player` and `settings`.
4. Shows row counts for confirmation, then **clears and restores all tables in a single transaction**. If anything
   fails, nothing changes.

`format` (`APP_CONFIG.exportFormatVersion`) is bumped only for incompatible changes. The importer is where old formats
get upgraded.

## Wiping

**Settings → Data → Erase everything** clears every table in one transaction after confirmation, then reboots into
onboarding.

## Storage durability on iOS

Safari may evict data of sites not used for a while. Home Screen apps are treated like apps and are much less
exposed. LifeForge calls `navigator.storage.persist()` where available, and "Export a LifeForge backup" is an activity
in the quest library as a regular reminder.
