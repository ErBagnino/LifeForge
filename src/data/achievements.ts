import type { Achievement, AchievementCategory, AchievementTier, Condition } from '@/types';
import { C } from '@/domain/counters';

const REWARDS: Record<AchievementTier, { xp: number; coins: number }> = {
  bronze: { xp: 50, coins: 20 },
  silver: { xp: 150, coins: 60 },
  gold: { xp: 400, coins: 150 },
  platinum: { xp: 1000, coins: 400 },
};

function ach(
  id: string,
  name: string,
  description: string,
  category: AchievementCategory,
  icon: string,
  condition: Condition | [string, number],
  tier: AchievementTier = 'bronze',
  hidden = false,
): Achievement {
  const cond: Condition = Array.isArray(condition) ? { type: 'counter', key: condition[0], gte: condition[1] } : condition;
  return { id, name, description, category, icon, tier, hidden, condition: cond, ...REWARDS[tier] };
}

const allStats = (min: number): Condition => ({
  type: 'all',
  of: ['strength', 'endurance', 'discipline', 'health', 'order', 'care', 'consistency', 'knowledge'].map((k) => ({
    type: 'counter' as const,
    key: C.stat(k),
    gte: min,
  })),
});

/** `{pet}` is replaced with the pet name at display time. */
export const SEED_ACHIEVEMENTS: Achievement[] = [
  // First steps
  ach('first_blood', 'First Blood', 'Complete your first quest.', 'first_steps', '🩸', [C.questsCompleted, 1]),
  ach('first_day', 'Day One', 'Finish your first full day.', 'first_steps', '🌅', [C.daysPlayed, 1]),
  ach('warming_up', 'Warming Up', 'Complete 10 quests.', 'first_steps', '🔥', [C.questsCompleted, 10]),
  ach('getting_serious', 'Getting Serious', 'Complete 50 quests.', 'first_steps', '📈', [C.questsCompleted, 50], 'silver'),
  ach('questaholic', 'Questaholic', 'Complete 250 quests.', 'first_steps', '🗡️', [C.questsCompleted, 250], 'gold'),
  ach('quest_legend', 'Quest Legend', 'Complete 1,000 quests.', 'long_term', '👑', [C.questsCompleted, 1000], 'platinum'),
  ach('first_side', 'Side Character', 'Complete your first side quest.', 'first_steps', '🧩', [C.questsSide, 1]),
  ach('side_hustler', 'Side Hustler', 'Complete 25 side quests.', 'first_steps', '🎒', [C.questsSide, 25], 'silver'),
  ach('side_master', 'Main Character Energy', 'Complete 150 side quests.', 'long_term', '🌟', [C.questsSide, 150], 'gold'),
  ach('first_challenge', 'Challenge Accepted', 'Complete a daily challenge.', 'first_steps', '⚡', [C.questsChallenge, 1]),
  ach('challenger', 'Challenger', 'Complete 20 daily challenges.', 'first_steps', '🏅', [C.questsChallenge, 20], 'silver'),
  ach('first_weekly', 'Chapter Closed', 'Complete a weekly quest.', 'first_steps', '📘', [C.questsWeekly, 1]),
  ach('weekly_warrior', 'Weekly Warrior', 'Complete 12 weekly quests.', 'first_steps', '📚', [C.questsWeekly, 12], 'gold'),
  ach('boss_slayer', 'Boss Slayer', 'Defeat a boss quest.', 'first_steps', '🐉', [C.questsBoss, 1], 'gold'),
  ach('boss_hunter', 'Boss Hunter', 'Defeat 5 boss quests.', 'long_term', '⚔️', [C.questsBoss, 5], 'platinum'),
  ach('lucky_find', 'Lucky Find', 'Complete a rare quest.', 'first_steps', '🍀', [C.questsRare, 1]),
  ach('epic_moment', 'Epic Moment', 'Complete an epic quest.', 'first_steps', '💜', [C.questsEpic, 1], 'silver'),
  ach('legendary', 'The Legend', 'Complete a legendary quest.', 'first_steps', '🧡', [C.questsLegendary, 1], 'gold'),

  // Training
  ach('first_rep', 'First Rep', 'Complete your first workout.', 'training', '🏋️', [C.workouts, 1]),
  ach('iron_beginner', 'Iron Beginner', 'Complete 10 workouts.', 'training', '🔩', [C.workouts, 10]),
  ach('iron_regular', 'Iron Regular', 'Complete 25 workouts.', 'training', '⛓️', [C.workouts, 25], 'silver'),
  ach('iron_veteran', 'Iron Veteran', 'Complete 100 workouts.', 'training', '🛡️', [C.workouts, 100], 'gold'),
  ach('iron_legend', 'Iron Legend', 'Complete 250 workouts.', 'training', '🗿', [C.workouts, 250], 'platinum'),
  ach('set_machine', 'Set Machine', 'Log 100 completed sets.', 'training', '🔁', [C.workoutSets, 100]),
  ach('thousand_sets', 'A Thousand Sets', 'Log 1,000 completed sets.', 'training', '🏗️', [C.workoutSets, 1000], 'gold'),
  ach('volume_10t', '10 Tonnes', 'Lift 10,000 kg of total volume.', 'training', '🚛', [C.workoutVolume, 10000], 'silver'),
  ach('volume_100t', '100 Tonnes', 'Lift 100,000 kg of total volume.', 'training', '🚢', [C.workoutVolume, 100000], 'gold'),
  ach('flawless', 'Flawless', 'Complete every set of a workout.', 'training', '💎', [C.workoutsPerfect, 1]),
  ach('flawless_10', 'Flawless ×10', 'Complete 10 perfect workouts.', 'training', '💠', [C.workoutsPerfect, 10], 'silver'),
  ach('strong_stat', 'Built Different', 'Reach 150 Strength points.', 'training', '💪', [C.stat('strength'), 150], 'silver'),

  // Nutrition
  ach('protein_rookie', 'Protein Rookie', 'Hit your protein target on one day.', 'nutrition', '🥚', [C.proteinDays, 1]),
  ach('protein_pro', 'Protein Pro', 'Hit your protein target on 30 days.', 'nutrition', '🍗', [C.proteinDays, 30], 'silver'),
  ach('protein_legend', 'Protein Legend', 'Hit your protein target on 100 days.', 'nutrition', '🥩', [C.proteinDays, 100], 'gold'),
  ach('calorie_sniper', 'Calorie Sniper', 'Stay within your calorie range on 7 days.', 'nutrition', '🎯', [C.calorieDays, 7]),
  ach('calorie_master', 'Calorie Master', 'Stay within your calorie range on 50 days.', 'nutrition', '🧮', [C.calorieDays, 50], 'gold'),
  ach('food_logger', 'Food Logger', 'Log nutrition on 14 days.', 'nutrition', '📝', [C.nutritionLogged, 14], 'silver'),
  ach('nutrition_nerd', 'Nutrition Nerd', 'Complete 50 nutrition quests.', 'nutrition', '🥗', [C.cat('nutrition'), 50], 'silver'),
  ach('nutrition_sage', 'Nutrition Sage', 'Complete 200 nutrition quests.', 'nutrition', '🧑‍🍳', [C.cat('nutrition'), 200], 'gold'),

  // Hydration
  ach('first_sip', 'First Sip', 'Drink 1 litre in total.', 'hydration', '🥤', [C.waterMl, 1000]),
  ach('hydrated', 'Hydrated', 'Drink 100 litres overall.', 'hydration', '💧', [C.waterMl, 100000], 'silver'),
  ach('aquaman', 'Human Aquarium', 'Drink 500 litres overall.', 'hydration', '🐠', [C.waterMl, 500000], 'gold'),
  ach('water_week', 'Water Week', 'Hit your water target on 7 days.', 'hydration', '🚰', [C.waterDays, 7]),
  ach('water_month', 'Hydration Habit', 'Hit your water target on 30 days.', 'hydration', '🌊', [C.waterDays, 30], 'silver'),
  ach('water_century', 'Hydro Century', 'Hit your water target on 100 days.', 'hydration', '🏝️', [C.waterDays, 100], 'gold'),

  // Walking
  ach('walker_10k', 'Baby Steps', 'Log 10,000 steps in total.', 'walking', '👣', [C.stepsTotal, 10000]),
  ach('walker_100k', 'Walker', 'Log 100,000 steps in total.', 'walking', '🚶', [C.stepsTotal, 100000]),
  ach('walker_1m', 'The Million', 'Log 1,000,000 steps in total.', 'walking', '🗺️', [C.stepsTotal, 1000000], 'gold'),
  ach('step_target_7', 'On Target', 'Hit your step target on 7 days.', 'walking', '👟', [C.stepsTargetDays, 7]),
  ach('step_target_30', 'Step Machine', 'Hit your step target on 30 days.', 'walking', '⚙️', [C.stepsTargetDays, 30], 'silver'),
  ach('ten_k_day', 'Five Digits', 'Walk 10,000 steps in a day.', 'walking', '🔟', [C.steps10k, 1]),
  ach('ten_k_20', 'Ten-K Club', 'Walk 10,000+ steps on 20 days.', 'walking', '🥾', [C.steps10k, 20], 'silver'),
  ach('distance_42', 'Marathon (Slowly)', 'Cover 42 km in total.', 'walking', '🏁', [C.distanceKm, 42], 'silver'),

  // Running / cardio
  ach('first_cardio', 'Heart Starter', 'Complete a cardio program session.', 'running', '❤️', [C.cardioSessions, 1]),
  ach('cardio_10', 'Cardio Regular', 'Complete 10 cardio sessions.', 'running', '🫀', [C.cardioSessions, 10]),
  ach('cardio_50', 'Engine Builder', 'Complete 50 cardio sessions.', 'running', '🏎️', [C.cardioSessions, 50], 'silver'),
  ach('first_run', 'Runner Unlocked', 'Complete your first continuous run stage session.', 'running', '🏃', [C.cardioRuns, 1], 'gold'),
  ach('runner_10', 'Actual Runner', 'Complete 10 continuous run sessions.', 'running', '🏃‍♂️', [C.cardioRuns, 10], 'gold'),

  // Home
  ach('tidy_start', 'Tidy Start', 'Complete 10 cleaning quests.', 'home', '🧽', [C.cat('cleaning'), 10]),
  ach('clean_machine', 'Clean Machine', 'Complete 100 cleaning quests.', 'home', '🫧', [C.cat('cleaning'), 100], 'silver'),
  ach('order_10', 'Things Have Places', 'Complete 10 order quests.', 'home', '🗂️', [C.cat('order'), 10]),
  ach('konmari', 'Konmari Apprentice', 'Complete 100 order quests.', 'home', '📦', [C.cat('order'), 100], 'silver'),
  ach('home_50', 'Homemaker', 'Complete 50 home quests.', 'home', '🏠', [C.cat('home'), 50], 'silver'),

  // Pet
  ach('pet_friend', "{pet}'s Friend", 'Complete 10 pet care tasks.', 'pet', '🐾', [C.cat('animal_care'), 10]),
  ach('skys_assistant', "{pet}'s Assistant", 'Complete 50 pet care tasks.', 'pet', '🥕', [C.cat('animal_care'), 50], 'silver'),
  ach('pet_guardian', "{pet}'s Guardian", 'Complete 250 pet care tasks.', 'pet', '🛡️', [C.cat('animal_care'), 250], 'gold'),
  ach('pet_legend', 'Legendary Caretaker', 'Complete 1,000 pet care tasks.', 'pet', '🏆', [C.cat('animal_care'), 1000], 'platinum'),

  // Routine
  ach('morning_person', 'Morning Person', 'Complete the morning routine 5 times.', 'routine', '🌅', [C.routinesMorning, 5]),
  ach('morning_master', 'Sunrise Master', 'Complete the morning routine 30 times.', 'routine', '☀️', [C.routinesMorning, 30], 'silver'),
  ach('night_routine', 'Wind-Down', 'Complete the night routine 5 times.', 'routine', '🌙', [C.routinesNight, 5]),
  ach('night_master', 'Night Ritualist', 'Complete the night routine 30 times.', 'routine', '🌌', [C.routinesNight, 30], 'silver'),
  ach('routine_100', 'Creature of Habit', 'Complete 100 routines.', 'routine', '🔄', [C.routinesAny, 100], 'gold'),
  ach('early_bird', 'Early Bird', 'Complete 10 quests before 7:00.', 'routine', '🐦', [C.questsEarly, 10], 'silver'),
  ach('glow_up', 'Glow Up', 'Complete 30 skincare quests.', 'routine', '✨', [C.cat('skincare'), 30]),
  ach('self_care', 'Self-Care Pro', 'Complete 100 personal care quests.', 'routine', '🪥', [C.cat('personal_care'), 100], 'silver'),
  ach('bookworm', 'Bookworm', 'Complete 20 reading quests.', 'routine', '📖', [C.cat('reading'), 20]),
  ach('scholar', 'Scholar', 'Complete 25 online learning quests.', 'routine', '🎓', [C.cat('online_learning'), 25], 'silver'),
  ach('zen', 'Zen Mode', 'Complete 30 mental wellbeing quests.', 'routine', '🧘', [C.cat('mental_wellbeing'), 30], 'silver'),
  ach('sleep_logger', 'Sleep Scientist', 'Log sleep 14 times.', 'routine', '😴', [C.sleepLogs, 14]),
  ach('outdoorsy', 'Outdoorsy', 'Complete 30 outdoor quests.', 'routine', '🌳', [C.cat('outdoor'), 30], 'silver'),

  // Consistency
  ach('perfect_core_first', 'Core Complete', 'Complete every core quest in a day.', 'consistency', '🎯', [C.daysPerfectCore, 1]),
  ach('no_excuses', 'No Excuses', 'Complete all core quests for 7 days in a row.', 'consistency', '🧱', [C.perfectCoreRunBest, 7], 'silver'),
  ach('core_30', 'Unbreakable Core', 'Complete all core quests for 30 days in a row.', 'consistency', '🪨', [C.perfectCoreRunBest, 30], 'platinum'),
  ach('perfect_core_50', 'Core Collector', 'Complete every core quest on 50 days.', 'consistency', '🗃️', [C.daysPerfectCore, 50], 'gold'),
  ach('full_clear', 'Full Clear', 'Complete every core and important quest in a day.', 'consistency', '🧹', [C.daysAllTiers, 1]),
  ach('streak_3', 'Spark', 'Reach a 3-day streak.', 'consistency', '🔥', [C.streakLongest, 3]),
  ach('streak_7', 'On Fire', 'Reach a 7-day streak.', 'consistency', '🔥', [C.streakLongest, 7]),
  ach('streak_14', 'Blaze', 'Reach a 14-day streak.', 'consistency', '🔥', [C.streakLongest, 14], 'silver'),
  ach('streak_30', 'Inferno', 'Reach a 30-day streak.', 'consistency', '🌋', [C.streakLongest, 30], 'gold'),
  ach('streak_50', 'Wildfire', 'Reach a 50-day streak.', 'consistency', '☄️', [C.streakLongest, 50], 'gold'),
  ach('century', 'Century', 'Maintain a streak for 100 days.', 'consistency', '💯', [C.streakLongest, 100], 'platinum'),
  ach('eternal_flame', 'Eternal Flame', 'Maintain a streak for 365 days.', 'long_term', '🕯️', [C.streakLongest, 365], 'platinum'),
  ach('weekly_streak_4', 'Month of Weeks', 'Reach a 4-week weekly streak.', 'consistency', '📆', [C.weeklyStreak, 4], 'silver'),
  ach('score_90', 'A-Game', 'Score 90+ on a day.', 'consistency', '🅰️', [C.daysScore90, 1]),
  ach('score_80_10', 'Reliable', 'Score 80+ on 10 days.', 'consistency', '📊', [C.daysScore80, 10], 'silver'),
  ach('perfect_100', 'Perfect Day', 'Score 100 on a day.', 'consistency', '💯', [C.daysScore100, 1], 'gold'),
  ach('days_30', 'Regular', 'Play 30 days.', 'consistency', '🗓️', [C.daysPlayed, 30], 'silver'),
  ach('days_100', 'Resident', 'Play 100 days.', 'long_term', '🏡', [C.daysPlayed, 100], 'gold'),
  ach('days_180', 'Half a Year of You', 'Play 180 days.', 'long_term', '🌗', [C.daysPlayed, 180], 'gold'),
  ach('days_365', 'Year One', 'Play 365 days.', 'long_term', '🎂', [C.daysPlayed, 365], 'platinum'),

  // Tycoon
  ach('home_sweet_home', 'Home Sweet Home', 'Place your first decoration.', 'tycoon', '🛋️', [C.decorations, 1]),
  ach('first_upgrade', 'First Upgrade', 'Build your first new room.', 'tycoon', '🏗️', [C.buildingsBuilt, 1]),
  ach('architect', 'Architect', 'Build 3 rooms.', 'tycoon', '📐', [C.buildingsBuilt, 3], 'silver'),
  ach('city_planner', 'City Planner', 'Build 8 rooms.', 'tycoon', '🏙️', [C.buildingsBuilt, 8], 'gold'),
  ach('upgrade_5', 'Renovator', 'Upgrade rooms 5 times.', 'tycoon', '🔨', [C.buildingUpgrades, 5]),
  ach('maxed_room', 'Maxed Out', 'Bring a room to max level.', 'tycoon', '🏆', [C.maxBuildingLevel, 5], 'gold'),
  ach('home_level_10', 'Growing Estate', 'Reach home level 10.', 'tycoon', '🏘️', [C.homeLevel, 10], 'silver'),
  ach('home_level_30', 'Forge Estate', 'Reach home level 30.', 'tycoon', '🏰', [C.homeLevel, 30], 'platinum'),
  ach('decorator', 'Interior Designer', 'Own 10 decorations.', 'tycoon', '🖼️', [C.decorations, 10], 'silver'),
  ach('fashionista', 'Fashionista', 'Own 10 cosmetics.', 'tycoon', '🕶️', [C.cosmetics, 10], 'silver'),

  // Level
  ach('level_5', 'Level 5', 'Reach level 5.', 'level', '5️⃣', [C.level, 5]),
  ach('level_10', 'Level 10', 'Reach level 10.', 'level', '🔟', [C.level, 10]),
  ach('level_20', 'Level 20', 'Reach level 20.', 'level', '🎖️', [C.level, 20], 'silver'),
  ach('level_30', 'Level 30', 'Reach level 30.', 'level', '🥉', [C.level, 30], 'gold'),
  ach('level_50', 'Level 50', 'Reach level 50.', 'level', '🥈', [C.level, 50], 'platinum'),
  ach('level_75', 'Level 75', 'Reach level 75.', 'level', '🥇', [C.level, 75], 'platinum'),
  ach('level_100', 'Level 100', 'Reach level 100. Absolute unit.', 'level', '👑', [C.level, 100], 'platinum'),

  // Coins
  ach('first_coins', 'Pocket Money', 'Earn 100 coins.', 'coins', '🪙', [C.coinsEarned, 100]),
  ach('saver', 'Saver', 'Hold 1,000 coins at once.', 'coins', '🐷', [C.coinsBalance, 1000]),
  ach('rich', 'Getting Rich', 'Earn 10,000 coins in total.', 'coins', '💰', [C.coinsEarned, 10000], 'silver'),
  ach('tycoon_coins', 'Tycoon', 'Earn 100,000 coins in total.', 'coins', '🏦', [C.coinsEarned, 100000], 'gold'),
  ach('spender', 'Investor', 'Spend 5,000 coins.', 'coins', '💸', [C.coinsSpent, 5000], 'silver'),
  ach('treat_yourself', 'Treat Yourself', 'Redeem a real-world reward.', 'coins', '🎁', [C.rewardsRedeemed, 1]),

  // XP
  ach('xp_1k', 'Kilo-XP', 'Earn 1,000 XP.', 'xp', '✨', [C.xpTotal, 1000]),
  ach('xp_10k', 'Experienced', 'Earn 10,000 XP.', 'xp', '🌠', [C.xpTotal, 10000], 'silver'),
  ach('xp_100k', 'Veteran', 'Earn 100,000 XP.', 'xp', '🌌', [C.xpTotal, 100000], 'gold'),
  ach('xp_1m', 'Mega-XP', 'Earn 1,000,000 XP.', 'xp', '🪐', [C.xpTotal, 1000000], 'platinum'),

  // Records
  ach('pr_machine', 'PR Machine', 'Set a personal record.', 'records', '📣', [C.prsTotal, 1]),
  ach('pr_10', 'Record Breaker', 'Set 10 personal records.', 'records', '📀', [C.prsTotal, 10], 'silver'),
  ach('pr_50', 'Hall of Fame', 'Set 50 personal records.', 'records', '🏛️', [C.prsTotal, 50], 'gold'),
  ach('steps_record', 'New Heights', 'Set a steps record.', 'records', '⛰️', [C.prsSteps, 1]),
  ach('renaissance', 'Renaissance', 'Reach 30 points in every stat.', 'long_term', '🎨', allStats(30), 'gold'),

  // Self-mastery (NoFap daily check-in) — discreet names on purpose
  ach('mastery_7', 'Self-Mastery I', 'Keep your daily 🛡️ check-in streak for 7 days.', 'consistency', '🛡️', [C.actStreak('nofap'), 7], 'silver'),
  ach('mastery_30', 'Self-Mastery II', 'Keep your daily 🛡️ check-in streak for 30 days.', 'consistency', '🛡️', [C.actStreak('nofap'), 30], 'gold'),
  ach('mastery_90', 'Self-Mastery III', 'Keep your daily 🛡️ check-in streak for 90 days. Rewired.', 'consistency', '🧠', [C.actStreak('nofap'), 90], 'platinum'),
  ach('mastery_365', 'Iron Will', 'Keep your daily 🛡️ check-in streak for 365 days.', 'long_term', '🏔️', [C.actStreak('nofap'), 365], 'platinum'),

  // Play-time budget
  ach('screen_first', 'In Control', 'Stay within your daily play-time budget.', 'consistency', '🎮', [C.leisureUnderDays, 1]),
  ach('screen_7', 'Screen Master', 'Stay within your play-time budget 7 days in a row.', 'consistency', '🕹️', [C.leisureUnderRunBest, 7], 'silver'),
  ach('screen_30', 'Attention Reclaimed', 'Stay within your play-time budget 30 days in a row.', 'consistency', '🧠', [C.leisureUnderRunBest, 30], 'gold'),
  ach('screen_100', 'Digital Monk', 'Stay within your play-time budget on 100 days.', 'long_term', '🧘', [C.leisureUnderDays, 100], 'platinum'),

  // Hidden
  ach('night_owl', 'Night Owl', 'Complete 10 quests after 23:00.', 'hidden', '🦉', [C.questsLate, 10], 'bronze', true),
  ach('weekend_warrior', 'Weekend Warrior', 'Complete 50 quests on weekends.', 'hidden', '🛡️', [C.questsWeekend, 50], 'silver', true),
  ach('snooze_lord', 'Professional Procrastinator', 'Snooze 25 times. We see you.', 'hidden', '😴', [C.snoozes, 25], 'bronze', true),
  ach('phoenix', 'Phoenix', 'Come back from Recovery Mode.', 'hidden', '🐦‍🔥', [C.recoveryExits, 1], 'gold', true),
  ach('flesh_wound', "It's Just a Flesh Wound", 'Get knocked out (HP 0) — and keep playing.', 'hidden', '🩹', [C.knockouts, 1], 'bronze', true),
  ach('reroller', 'Gambler', 'Reroll 10 quests.', 'hidden', '🎲', [C.rerolls, 10], 'bronze', true),
  ach('cold_storage', 'Cold Storage', 'Use a Streak Freeze.', 'hidden', '🧊', [C.freezesUsed, 1], 'bronze', true),
  ach('necromancer', 'Necromancer', 'Revive a broken streak.', 'hidden', '🧟', [C.revivesUsed, 1], 'bronze', true),
  ach('hidden_hunter', 'Secret Seeker', 'Complete 5 hidden quests.', 'hidden', '🕵️', [C.questsHidden, 5], 'silver', true),
  ach('prompt_engineer', 'Prompt Engineer', 'Import an activity created with AI.', 'hidden', '🤖', [C.aiImported, 1], 'bronze', true),
  ach('game_designer', 'Game Designer', 'Create 5 custom activities.', 'hidden', '🛠️', [C.activitiesCreated, 5], 'silver', true),
  ach('self_aware', 'Self-Aware', 'Read 10 daily recaps.', 'hidden', '🪞', [C.reviewsDaily, 10], 'bronze', true),
  ach('chapter_reader', 'Chapter Reader', 'Read 4 weekly reviews.', 'hidden', '📖', [C.reviewsWeekly, 4], 'bronze', true),
  ach('rest_master', 'Recovery Is Training', 'Take 5 planned rest days.', 'hidden', '🛌', [C.restDays, 5], 'silver', true),
  ach('time_lord', 'Time Lord', 'Adjust your timeline 10 times.', 'hidden', '⏳', [C.timelineEdits, 10], 'bronze', true),
  ach('big_spender', 'Shopaholic', 'Buy 10 shop items.', 'hidden', '🛍️', [C.shopPurchases, 10], 'bronze', true),
];
