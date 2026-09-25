# Database

LifeForge stores everything in **IndexedDB** through **Dexie 4**. The database is named `lifeforge`
(`APP_CONFIG.dbName`) and is defined in `src/repositories/db.ts`, the only file that knows about Dexie.
Types live in `src/types/*`.

## Tables

| Table | Primary key | Indexes | Contents |
| --- | --- | --- | --- |
| `meta` | `key` | | Key/value: `seedVersion`, `currentDate` (last started game day), `leisureTimer` (running play-time timer). |
| `player` | `id` | | Single row `"me"`: xp, coins, hp, energy, stats, streak state, inventory (freezes, revives, rerolls), boosts, status effects, recovery mode, avatar, unlocked features. |
| `settings` | `id` | | Single row `"settings"`: profile, schedule, work hours, body & nutrition, step targets, hydration, leisure budget, safety bounds, notifications, appearance, coach tone, difficulty, and the full editable `rules` (`GameRules`). Normalised on read, so new fields get defaults. |
| `activities` | `id` | `category, tier, active` | The activity library (123 seeded): tier, recurrence, difficulty, duration, time of day, metric & mode, stats, tags, scalability. Editable in Admin. |
| `routines` | `id` | | Morning/night routines: ordered activity ids, time, bonus. |
| `quests` | `id` | `date, endDate, kind, status, activityId, [date+kind], [activityId+date]` | Quest instances per game day (plus multi-day weekly/boss quests with `endDate`). Stores status, progress, snoozes, `earned` (for undo/history), reason, `private`, `lightened`. |
| `dayLogs` | `date` | | One row per game day: score breakdown, metrics totals, workload, adaptive state, energy/HP deltas, streak event, penalties, rules fired, routines done, `closed` flag. |
| `dayPlans` | `date` | | Editable timeline/plan: wake, sleep, work block, busy blocks, day type (work/free/rest). |
| `metrics` | `id` | `date, type, [date+type], [type+date]` | Raw manual entries: steps, distance, water, calories, protein, weight, sleep, workout minutes, **leisure** (play-time minutes, `note` = kind)… |
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

**Schema changes** use Dexie versioning: add `this.version(2).stores({...}).upgrade(tx => …)` in `db.ts`, keeping
version 1 intact. Dexie upgrades existing installs in place on the next launch.

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
