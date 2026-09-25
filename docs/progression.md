# Progression

Every formula lives in `src/domain/*` and reads its constants from `settings.rules` (`GameRules`), so all of them can be
edited in **Admin → Economy / Game rules** without touching code. Defaults are in `src/data/defaultRules.ts`.

## 1. Levels

```
xpToNext(L) = round(150 × L^1.35 / 10) × 10          (rules.level.base = 150, exponent = 1.35)
```

| Level | XP to next | Total XP to reach |
| ---: | ---: | ---: |
| 1 | 150 | 0 |
| 2 | 380 | 150 |
| 3 | 660 | 530 |
| 5 | 1,320 | 2,160 |
| 8 | 2,480 | 7,230 |
| 10 | 3,360 | 12,620 |
| 20 | 8,560 | 68,610 |
| 30 | 14,800 | 181,570 |
| 50 | 29,490 | 612,820 |

The curve is steep enough that early levels come within days (level 2 on day 1, which unlocks side quests) and later
levels take weeks. The maximum level is 200.

**Level perks:** every level gives `20 + 5 × level` coins; every 3rd level a Quest Reroll, every 5th a Streak Freeze,
every 10th a Streak Revive. Feature unlocks: side quests L2 · daily challenge L3 · hidden quests L4 · weekly quests L5 ·
boss quests L8. Rooms unlock from L1 (bedroom) to L15 (storage vault).

## 2. Quest rewards

Base values are computed when a quest is created (`computeQuestValues`):

```
energyCost = costByDifficulty[d] + max(0, round((duration − 20) / 10))        // recovery categories restore instead
xp   = base[d] × durationFactor × importanceFactor × frequencyFactor × effortFactor × rarity × levelFactor   (≥ 5, rounded to 5)
coins = round(xp × 0.3)                                                          // or activity.baseCoins × rarity
```

| Factor | Formula / values |
| --- | --- |
| `base[d]` (difficulty 1–5) | 15 · 35 · 70 · 140 · 280 |
| `durationFactor` | `1 + clamp((duration − ref[d]) / 60, −0.3, +0.5)`, ref = 5 · 15 · 25 · 45 · 60 min |
| `importanceFactor` | `0.9 + importance × 0.04` (importance 1–5) |
| `frequencyFactor` | daily 1.0 · fewer days/week up to +20–30% · every N days up to +30% |
| `effortFactor` | `1 + min(energyCost, 40) / 200` |
| `rarity` | common 1 · uncommon 1.25 · rare 1.6 · epic 2.2 · legendary 3 |
| `levelFactor` | `1 + min(level − 1, 40) × 0.015` (up to +60%, so rewards keep pace with the curve) |

Example: *Brush teeth* (difficulty 1, 3 min, importance 3, daily, common, level 1) → **15 XP, 5 coins**.

**Completion-time multipliers** (`rewardMultipliers`, each shown in the quest sheet so the numbers are explained):
difficulty preset (Casual ×0.9 … Insane ×1.25), streak +1% per day (max +20%, XP only), world bonus for the category,
XP Booster / Coin Magnet (+25% for 24 h), status effects (e.g. *Sluggish* XP ×0.9).

Other income: first quest of the day +25 coins; streak milestones `round(40 × √days)` coins (3 d → 69, 7 d → 106,
30 d → 219, 100 d → 400); level perks; world income `dailyIncome × yesterday's score / 100` (0 below a score of 30);
achievements by tier (bronze 50 XP / 20 coins · silver 150 / 60 · gold 400 / 150 · platinum 1,000 / 400).

## 3. Economy sinks

| Sink | Price |
| --- | --- |
| Rooms | `baseCost × growth^(level−1)`, e.g. Gym 500 → 1,500 → 4,500 → 13,500 → 40,500 |
| Streak Freeze / Revive | 250 / 600 |
| Quest Reroll | 30 (or a Reroll item) |
| XP Booster / Coin Magnet | 300 / 350 |
| Decorations & cosmetics | 30 – 3,000 (starter items free) |
| Real-world rewards | your own price, only after you approve them |

Coin penalties are capped at 25/day and can't push you below 0.

## 4. Strength training

The seeded plan: **Mon Upper A · Wed Lower + Core · Fri Upper B**, 3 sets, rest 60–120 s. Starting weights are
conservative (`STARTING_WEIGHTS` in `src/data/exercises.ts`) and editable per exercise.

After each session `suggestProgression` looks at the last sessions for each exercise and writes a **suggestion** that
you answer YES or NO on the next session screen. Nothing changes automatically.

Default rule for loaded exercises: `increment 2.5 kg · maxIncreasePct 15 · easyRpeMax 2 · requireAllSets · requireTopOfRange ·
deload after 3 failures by 10%`. Small isolation lifts use a 1 kg increment, bodyweight moves +2 reps, and timed holds +5 s.

| Situation (last session) | Suggestion |
| --- | --- |
| All sets done, every set at the top of the range (or all ≥ mid-range and very easy), avg RPE ≤ 🙂 | **Increase** by the increment, capped by the safety % (smaller jump or "+2 reps first" if the cap is exceeded). The rep range restarts from the bottom. |
| Target reached but it felt hard | **Maintain** until it feels normal. |
| Sets done, reps below target | **Add reps** (+1 rep per set before adding weight). |
| 1 failed session (missed sets, reps < min, or 💀) | **Maintain**: one tough day isn't a trend. |
| 2 failed sessions | **Maintain**, or **return to the last weight you completed cleanly** if reps fell below the minimum. |
| 3 failed sessions | **Deload** −10% (bodyweight/timed: −2 reps / shorter target). The *Deload guard* smart rule also surfaces it. |

RPE scale: 😎 Easy · 🙂 Normal · 😰 Hard · 💀 Almost impossible.

**Worked example (from the spec):** chest press 20 kg, range 8–12, sets 10/10/10 all 😎. Range top isn't reached, but
every set is past mid-range and very easy → **22.5 kg for 8–10 reps** (+12.5%, under the 15% cap). The card reads
*"All 3 sets done, reps on target, effort easy. Try 22.5 kg."*

Records: heaviest weight, most reps, best volume per exercise, and estimated 1RM trends (Epley) for charts.

## 5. Cardio: walk → run

Nine stages (`src/data/cardio.ts`), 3 sessions a week each:

`Brisk walk 30′ → 35′ → 40′ → Walk/run intervals I (6 × 1′ jog + 3′ walk) → II (6 × 2′/2′) → III (5 × 4′/1′) → Light run 20′ → 24′ → 28′`

Weekly evaluation (`evaluateCardioWeek`):

- **Advance** one stage when ≥ 80% of the planned sessions were done, average difficulty ≤ 2.3/4, and at least one week was
  spent at the stage, provided a same-intensity duration jump stays within `maxCardioIncreasePct` (20%).
- **Step back** after two weeks under 50% completion, or when sessions felt close to max (≥ 3.5/4).
- Otherwise **hold**.

Cardio sessions are scheduled on non-gym days where possible. Advancing is a suggestion you accept.

## 6. Steps

Default targets: **min 5,500 · ideal 6,500 · stretch 8,500**. `recommendStepTargets` needs at least 5 logged days out
of the last 7:

- Ideal hit on ≥ 5 days → **+250** (one `stepIncrement`, never more than +5%): 6,500 → 6,750 → 7,000 …
  Min becomes 85% of ideal and stretch 130%.
- Minimum hit on ≤ 2 days → −250 so the bar is winnable again.
- Always clamped to 3,000 – 20,000.

## 7. Nutrition & body

Starting values (editable, not medical advice): **74 kg · 170 cm · 1,800 kcal · 150 g protein · 55 g fat · ~175 g carbs ·
2–2.5 L water**, goal *lose fat*.

- **Calories** (`recommendCalories`): needs ≥ 4 weigh-ins spanning ≥ 2 weeks and ≥ 70% logging adherence. Losing faster than
  1% body weight/week → +150 kcal; flat weight with good adherence → −150 kcal. Always within 1,500 – 3,200 kcal and at most
  ±150 per change.
- **Protein**: suggested only if outside 1.4 – 2.4 g/kg.
- The score rewards being **within ±10% of the calorie target**, not eating less. There's no bonus for undereating, and no
  fasting or skipped-meal quests exist.

## 8. Adaptive difficulty & workload

**Workload (0–100)** = `work min / 600 × 50` (a 10 h workday = 50) + `busy hours × 6` + `planned quest minutes / free
minutes × 20` (capped at 1.5×) + 5 for a workout + up to 15 for low starting energy. Levels: low < 35 ≤ medium < 65 ≤ high.

| Workload | Max effortful core | Max important | Side quests | Max side duration |
| --- | ---: | ---: | ---: | ---: |
| low | 8 | 8 | 4 | 45 min |
| medium | 5 | 5 | 2 | 20 min |
| high | 4 | 3 | 1 | 10 min |

Quests of ≤ 5 minutes (teeth, the NoFap check-in, a glass of water…) don't count against the caps. Above the cap, the
least important (then longest) quests are **demoted to optional**, never deleted. Protected quests (the workout and
metric-tracked ones like water, steps, protein and the play-time budget) are kept first.

**Difficulty state** (each morning):

| State | When | Effect |
| --- | --- | --- |
| Critical | HP < 25, or energy < 25, or workload ≥ 88 with energy < 40 | no side quests or challenge, core only |
| Overloaded | workload ≥ 70, or energy < 35, or 7-day completion < 50%, or ≥ 4 core quests missed in 3 days | max 1 side quest of ≤ 10 min |
| Too easy | 7-day completion ≥ 90%, workload < 45 and energy ≥ 60 | +2 side quests, +15 min max duration, rarer challenge |
| Balanced | otherwise | defaults |

## 9. Habit learning & suggestions

- `learnTimes` finds the median real completion time for recurring quests (you can correct the actual time after
  completing). With ≥ 5 samples, a tight spread, and ≥ 45 min away from the planned time, it proposes moving the quest.
- All suggestions (weights, cardio stage, steps, calories, times, deload, rest day) go to the `suggestions` table and show
  up as **YES/NO cards**. Declines are remembered per suggestion key, so the same proposal doesn't come back right away.
