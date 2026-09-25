import type { Activity, ActivityCategory, Recurrence } from '@/types';
import { CATEGORY_INFO } from './categories';

type Opts = Partial<Omit<Activity, 'id' | 'name' | 'icon' | 'category'>>;

const daily: Recurrence = { type: 'daily' };
const pool: Recurrence = { type: 'pool' };
const perWeek = (times: number): Recurrence => ({ type: 'timesPerWeek', times });
const every = (n: number): Recurrence => ({ type: 'everyNDays', n });
const days = (...d: number[]): Recurrence => ({ type: 'weekdays', days: d });

/** `{pet}` in names/descriptions is replaced with the pet name from settings. */
function A(id: string, name: string, icon: string, category: ActivityCategory, opts: Opts = {}): Activity {
  const tier = opts.tier ?? 'optional';
  const recurrence = opts.recurrence ?? pool;
  return {
    id,
    name,
    icon,
    category,
    tier,
    importance: tier === 'core' ? 5 : tier === 'important' ? 4 : 2,
    difficulty: 2,
    recurrence,
    timeOfDay: 'anytime',
    durationMin: 10,
    stats: { ...CATEGORY_INFO[category].stats },
    adaptive: false,
    active: true,
    streakEligible: recurrence.type !== 'pool',
    generatorEligible: tier === 'optional' && recurrence.type === 'pool',
    userCreated: false,
    aiImported: false,
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  };
}

export const SEED_ACTIVITIES: Activity[] = [
  // ——— CORE ———
  A('drink_water', 'Drink water', '💧', 'hydration', {
    tier: 'core', recurrence: daily, difficulty: 2, durationMin: 5, metric: 'water', unit: 'ml',
    description: 'Reach your daily water target. Log glasses as you go.', adaptive: true,
    safety: { min: 1500, max: 4000, maxIncreasePct: 10 },
  }),
  A('hit_steps', 'Hit step target', '👟', 'cardio', {
    tier: 'core', recurrence: daily, difficulty: 3, durationMin: 30, metric: 'steps', unit: 'steps',
    description: 'Reach your ideal step target. Log the total from your watch.', adaptive: true,
    safety: { min: 3000, max: 20000, maxIncreasePct: 5 }, stats: { endurance: 2, health: 1 },
  }),
  A('protein_target', 'Hit protein target', '🥩', 'nutrition', {
    tier: 'core', recurrence: daily, difficulty: 3, durationMin: 5, metric: 'protein', unit: 'g', timeOfDay: 'evening',
    description: 'Reach your protein target for the day.',
  }),
  A('log_meals', 'Log all meals', '🍽️', 'nutrition', {
    tier: 'core', recurrence: daily, difficulty: 2, durationMin: 5, timeOfDay: 'evening', preferredTime: '21:00',
    description: 'Log calories and macros for every meal. Awareness, not perfection.',
  }),
  A('pet_water', "Change {pet}'s water", '🚰', 'animal_care', {
    tier: 'core', recurrence: daily, difficulty: 1, durationMin: 3, timeOfDay: 'morning', preferredTime: '07:30',
  }),
  A('pet_food', "Refill {pet}'s food", '🥣', 'animal_care', {
    tier: 'core', recurrence: daily, difficulty: 1, durationMin: 3, timeOfDay: 'morning', preferredTime: '07:35',
  }),
  A('brush_am', 'Brush teeth (morning)', '🪥', 'personal_care', {
    tier: 'core', recurrence: daily, difficulty: 1, durationMin: 3, timeOfDay: 'morning', preferredTime: '07:15', importance: 4,
  }),
  A('brush_pm', 'Brush teeth (night)', '🪥', 'personal_care', {
    tier: 'core', recurrence: daily, difficulty: 1, durationMin: 3, timeOfDay: 'night', preferredTime: '23:00', importance: 4,
  }),
  A('nofap', 'NoFap — stayed clean today', '🛡️', 'mental_wellbeing', {
    tier: 'core', recurrence: daily, difficulty: 3, durationMin: 1, timeOfDay: 'night', preferredTime: '22:50', importance: 5,
    description:
      'Daily check-in: no masturbation today. Check it off at night. A slip is data, not a verdict — log it honestly with Skip and start the next day clean.',
    stats: { discipline: 3, consistency: 1 }, energyCost: 0, tags: ['nofap', 'private'],
  }),
  A('cardio_session', 'Cardio program session', '🏃', 'cardio', {
    tier: 'important', recurrence: perWeek(3), difficulty: 3, durationMin: 30, timeOfDay: 'evening', preferredTime: '20:00',
    description: 'Session from your walk → run program. Tap to see today’s stage.', availableOn: 'any',
    stats: { endurance: 3, health: 1 }, tags: ['cardio_program'],
  }),

  // ——— IMPORTANT ———
  A('shower', 'Shower', '🚿', 'personal_care', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 10, timeOfDay: 'morning', preferredTime: '07:20', importance: 3 }),
  A('make_bed', 'Make the bed', '🛏️', 'home', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 2, timeOfDay: 'morning', preferredTime: '07:10', importance: 3, stats: { order: 1, discipline: 1 } }),
  A('skincare_am', 'Morning skincare', '🧴', 'skincare', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 5, timeOfDay: 'morning', preferredTime: '07:25', importance: 3 }),
  A('skincare_pm', 'Night skincare', '🧴', 'skincare', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 5, timeOfDay: 'night', preferredTime: '22:30', importance: 4 }),
  A('prep_clothes', 'Prepare clothes for tomorrow', '👕', 'home', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 5, timeOfDay: 'night', preferredTime: '22:15', importance: 3, stats: { order: 1, discipline: 1 } }),
  A('daily_review', 'Daily review', '📜', 'mental_wellbeing', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 3, timeOfDay: 'night', preferredTime: '22:45', importance: 3, description: 'Open the Daily Recap and look at your day for one minute.', stats: { discipline: 1, consistency: 1 } }),
  A('read_10', 'Read 10 minutes', '📖', 'reading', {
    tier: 'important', recurrence: daily, difficulty: 2, durationMin: 10, unit: 'min', quantity: 10, timeOfDay: 'night', preferredTime: '23:00', importance: 3,
    description: 'A book or a solid online article. Both count.', scalable: { field: 'duration', min: 10, max: 30, step: 5 },
  }),
  A('log_sleep', 'Log last night’s sleep', '😴', 'sleep', { tier: 'important', recurrence: daily, difficulty: 1, durationMin: 1, metric: 'sleep', unit: 'h', timeOfDay: 'morning', preferredTime: '07:05', importance: 3, description: 'Logging sleep sets today’s Energy.' }),
  A('shave', 'Shave', '🪒', 'personal_care', { tier: 'important', recurrence: perWeek(1), difficulty: 1, durationMin: 10, timeOfDay: 'morning', importance: 2, description: 'Default once a week — change the frequency any time.' }),
  A('pet_cage_clean', "Clean {pet}'s cage area", '🧼', 'animal_care', { tier: 'important', recurrence: perWeek(2), difficulty: 3, durationMin: 25, importance: 4 }),
  A('trash_out', 'Take out the trash', '🗑️', 'home', { tier: 'important', recurrence: every(2), difficulty: 1, durationMin: 5, timeOfDay: 'evening', importance: 3, stats: { order: 1 } }),
  A('weekly_review', 'Weekly review', '🗓️', 'productivity', { tier: 'important', recurrence: days(0), difficulty: 2, durationMin: 15, timeOfDay: 'evening', importance: 3, description: 'Open the Weekly Review and set your intentions for next week.' }),
  A('grocery', 'Grocery shopping', '🛒', 'nutrition', { tier: 'important', recurrence: perWeek(1), difficulty: 2, durationMin: 45, availableOn: 'freeday', importance: 3, stats: { health: 1, order: 1 } }),
  A('change_sheets', 'Change bed sheets', '🛏️', 'cleaning', { tier: 'important', recurrence: every(10), difficulty: 2, durationMin: 15, importance: 2 }),
  A('clean_bathroom', 'Clean the bathroom', '🛁', 'cleaning', { tier: 'important', recurrence: perWeek(1), difficulty: 3, durationMin: 30, availableOn: 'freeday', importance: 3 }),
  A('clean_room', 'Clean the room', '🧹', 'cleaning', { tier: 'important', recurrence: perWeek(1), difficulty: 3, durationMin: 30, availableOn: 'freeday', importance: 3 }),
  A('water_plants', 'Water the plants', '🪴', 'home', { tier: 'optional', recurrence: every(3), difficulty: 1, durationMin: 3, importance: 2, stats: { care: 1 } }),
  A('log_weight', 'Log weight', '⚖️', 'body', { tier: 'optional', recurrence: perWeek(3), difficulty: 1, durationMin: 1, metric: 'weight', unit: 'kg', timeOfDay: 'morning', importance: 2, description: 'Same time, same conditions. It is data, not a verdict.' }),

  // ——— SIDE QUEST POOL ———
  // Fitness / body
  A('stretching', 'Stretching', '🤸', 'fitness', { difficulty: 2, durationMin: 10, scalable: { field: 'duration', min: 5, max: 20, step: 5 }, unit: 'min', stats: { health: 1, endurance: 1 } }),
  A('mobility', 'Mobility routine', '🧘‍♂️', 'fitness', { difficulty: 2, durationMin: 12, stats: { health: 1, strength: 1 } }),
  A('pushups', 'Push-up set', '💪', 'fitness', { difficulty: 2, durationMin: 5, quantity: 15, unit: 'reps', scalable: { field: 'quantity', min: 8, max: 30, step: 2 } }),
  A('squats_bw', 'Bodyweight squats', '🦵', 'fitness', { difficulty: 2, durationMin: 5, quantity: 25, unit: 'reps', scalable: { field: 'quantity', min: 15, max: 50, step: 5 } }),
  A('core_circuit', 'Core circuit', '🔥', 'fitness', { difficulty: 3, durationMin: 12, stats: { strength: 2, discipline: 1 } }),
  A('plank_break', 'Plank break', '🧱', 'fitness', { difficulty: 2, durationMin: 3, quantity: 60, unit: 'sec', scalable: { field: 'quantity', min: 30, max: 120, step: 15 } }),
  A('foam_roll', 'Foam rolling', '🧻', 'rest', { difficulty: 1, durationMin: 10, stats: { health: 2 } }),
  A('posture_check', 'Posture reset', '🧍', 'body', { difficulty: 1, durationMin: 2 }),
  A('hiit_short', 'Short HIIT session', '⚡', 'fitness', { difficulty: 4, durationMin: 20, stats: { endurance: 2, strength: 1 }, availableOn: 'freeday' }),
  // Cardio / outdoor
  A('extra_walk', 'Brisk walk', '🚶', 'cardio', { difficulty: 2, durationMin: 15, unit: 'min', scalable: { field: 'duration', min: 5, max: 40, step: 5 }, stats: { endurance: 2, health: 1 } }),
  A('stairs', 'Take the stairs', '🪜', 'cardio', { difficulty: 1, durationMin: 3 }),
  A('evening_walk', 'Evening walk', '🌆', 'outdoor', { difficulty: 2, durationMin: 20, timeOfDay: 'evening', scalable: { field: 'duration', min: 10, max: 40, step: 5 }, unit: 'min' }),
  A('daylight', 'Get 10 min of daylight', '☀️', 'outdoor', { difficulty: 1, durationMin: 10, timeOfDay: 'morning', stats: { health: 1 } }),
  A('park_walk', 'Walk in a park', '🌳', 'outdoor', { difficulty: 2, durationMin: 30, availableOn: 'freeday' }),
  A('outdoor_lunch', 'Lunch break outside', '🥪', 'outdoor', { difficulty: 1, durationMin: 20, timeOfDay: 'midday', availableOn: 'workday' }),
  A('explore', 'Explore a new street or place', '🧭', 'outdoor', { difficulty: 3, durationMin: 40, availableOn: 'freeday', stats: { endurance: 1, knowledge: 1 } }),
  A('bike_ride', 'Bike ride', '🚴', 'cardio', { difficulty: 3, durationMin: 30, availableOn: 'freeday', stats: { endurance: 3 } }),
  // Nutrition / hydration
  A('water_wakeup', 'Glass of water after waking up', '🥛', 'hydration', { difficulty: 1, durationMin: 1, timeOfDay: 'morning' }),
  A('refill_bottle', 'Refill your water bottle', '🍶', 'hydration', { difficulty: 1, durationMin: 2 }),
  A('veggies', 'Eat a portion of vegetables', '🥦', 'nutrition', { difficulty: 1, durationMin: 5 }),
  A('fruit', 'Eat a piece of fruit', '🍎', 'nutrition', { difficulty: 1, durationMin: 3 }),
  A('cook_home', 'Cook a home meal', '🍳', 'nutrition', { difficulty: 3, durationMin: 40, timeOfDay: 'evening', stats: { health: 2, care: 1 } }),
  A('meal_prep', 'Prep tomorrow’s lunch', '🥡', 'nutrition', { difficulty: 2, durationMin: 20, timeOfDay: 'evening', availableOn: 'workday' }),
  A('healthy_breakfast', 'Protein-rich breakfast', '🍳', 'nutrition', { difficulty: 2, durationMin: 15, timeOfDay: 'morning' }),
  A('plan_meals', 'Plan meals for the week', '📝', 'nutrition', { difficulty: 2, durationMin: 20, availableOn: 'freeday', stats: { health: 1, order: 1 } }),
  A('no_sugary_drinks', 'No sugary drinks today', '🚫', 'nutrition', { difficulty: 2, durationMin: 1 }),
  // Personal care / skincare
  A('floss', 'Floss', '🦷', 'personal_care', { difficulty: 1, durationMin: 3, timeOfDay: 'night' }),
  A('nails', 'Trim nails', '💅', 'personal_care', { difficulty: 1, durationMin: 10 }),
  A('face_mask', 'Face mask', '🧖', 'skincare', { difficulty: 1, durationMin: 15, timeOfDay: 'evening' }),
  A('sunscreen', 'Apply sunscreen', '🧴', 'skincare', { difficulty: 1, durationMin: 2, timeOfDay: 'morning' }),
  A('haircut_book', 'Book a haircut', '💇', 'personal_care', { difficulty: 1, durationMin: 5 }),
  A('lip_care', 'Lip balm & hand cream', '👄', 'skincare', { difficulty: 1, durationMin: 2 }),
  // Home / cleaning / order
  A('load_dishwasher', 'Load the dishwasher', '🍽️', 'cleaning', { difficulty: 1, durationMin: 5 }),
  A('unload_dishwasher', 'Unload the dishwasher', '🍽️', 'cleaning', { difficulty: 1, durationMin: 5 }),
  A('wipe_counters', 'Wipe kitchen counters', '🧽', 'cleaning', { difficulty: 1, durationMin: 5 }),
  A('clean_sink', 'Clean the bathroom sink', '🚰', 'cleaning', { difficulty: 1, durationMin: 5 }),
  A('vacuum', 'Vacuum a room', '🧹', 'cleaning', { difficulty: 2, durationMin: 15 }),
  A('dust', 'Dust surfaces', '🪶', 'cleaning', { difficulty: 1, durationMin: 10 }),
  A('mop', 'Mop the floor', '🪣', 'cleaning', { difficulty: 2, durationMin: 20, availableOn: 'freeday' }),
  A('clean_fridge', 'Clean out the fridge', '🧊', 'cleaning', { difficulty: 3, durationMin: 25, availableOn: 'freeday' }),
  A('clean_mirror', 'Clean mirrors', '🪞', 'cleaning', { difficulty: 1, durationMin: 5 }),
  A('small_zone', 'Clean one small zone', '✨', 'cleaning', { difficulty: 1, durationMin: 10, scalable: { field: 'duration', min: 5, max: 20, step: 5 }, unit: 'min' }),
  A('room_reset', 'Room reset', '🔄', 'order', { difficulty: 1, durationMin: 10, unit: 'min', scalable: { field: 'duration', min: 5, max: 15, step: 5 }, description: 'Timer on. Put everything back where it belongs.' }),
  A('organize_desk', 'Organize your desk', '🗄️', 'order', { difficulty: 2, durationMin: 10 }),
  A('declutter_drawer', 'Declutter one drawer', '🗃️', 'order', { difficulty: 2, durationMin: 15 }),
  A('digital_cleanup', 'Digital cleanup', '🧹', 'order', { difficulty: 1, durationMin: 5, unit: 'min', scalable: { field: 'duration', min: 5, max: 20, step: 5 }, description: 'Photos, downloads, desktop, apps you never open.' }),
  A('inbox_zero', 'Inbox zero sprint', '📥', 'productivity', { difficulty: 2, durationMin: 15 }),
  A('wardrobe', 'Organize the wardrobe', '👔', 'order', { difficulty: 3, durationMin: 30, availableOn: 'freeday' }),
  A('things_back', 'Put 10 things back in place', '📦', 'order', { difficulty: 1, durationMin: 5 }),
  A('fix_small', 'Fix one small thing at home', '🔧', 'home', { difficulty: 2, durationMin: 20, availableOn: 'freeday', stats: { order: 1, knowledge: 1 } }),
  A('pack_bag', 'Pack your bag for tomorrow', '🎒', 'home', { difficulty: 1, durationMin: 5, timeOfDay: 'night', availableOn: 'workday' }),
  // Pet
  A('pet_bond', 'Bonding time with {pet}', '💞', 'animal_care', { difficulty: 1, durationMin: 15, stats: { care: 2 } }),
  A('pet_spot_clean', "Spot-clean {pet}'s area", '🧽', 'animal_care', { difficulty: 1, durationMin: 5 }),
  A('pet_health_check', "Quick health check for {pet}", '🩺', 'animal_care', { difficulty: 1, durationMin: 5 }),
  A('pet_treat', 'Prepare a fresh treat for {pet}', '🥕', 'animal_care', { difficulty: 1, durationMin: 5 }),
  A('pet_supplies', "Restock {pet}'s supplies", '🛍️', 'animal_care', { difficulty: 2, durationMin: 20, availableOn: 'freeday' }),
  // Productivity / learning
  A('plan_tomorrow', 'Plan tomorrow', '🗒️', 'productivity', { difficulty: 1, durationMin: 5, timeOfDay: 'night', stats: { discipline: 1, order: 1 } }),
  A('deep_work', 'Deep work block', '🎧', 'productivity', { difficulty: 3, durationMin: 25, unit: 'min', scalable: { field: 'duration', min: 25, max: 50, step: 25 } }),
  A('admin_10', 'Life admin (bills, forms)', '🧾', 'productivity', { difficulty: 2, durationMin: 10 }),
  A('todo_backlog', 'Clear 3 to-dos from the backlog', '✅', 'productivity', { difficulty: 2, durationMin: 15 }),
  A('calendar_check', 'Check tomorrow’s calendar', '📅', 'productivity', { difficulty: 1, durationMin: 2, timeOfDay: 'evening' }),
  A('read_article', 'Read an online article', '📰', 'reading', { difficulty: 1, durationMin: 10, description: 'Something worth your attention — not a feed.' }),
  A('read_pages', 'Read 20 pages', '📚', 'reading', { difficulty: 2, durationMin: 25, quantity: 20, unit: 'pages' }),
  A('read_no_phone', 'Read before bed, phone away', '🌙', 'reading', { difficulty: 2, durationMin: 15, timeOfDay: 'night', stats: { knowledge: 1, discipline: 1 } }),
  A('edu_video', 'Watch an educational video', '🎬', 'online_learning', { difficulty: 1, durationMin: 15 }),
  A('course_lesson', 'Online course lesson', '🎓', 'online_learning', { difficulty: 3, durationMin: 30 }),
  A('language', 'Language practice', '🗣️', 'online_learning', { difficulty: 2, durationMin: 10, unit: 'min', scalable: { field: 'duration', min: 5, max: 20, step: 5 } }),
  A('podcast', 'Listen to a learning podcast', '🎙️', 'online_learning', { difficulty: 1, durationMin: 20 }),
  A('write_notes', 'Write notes on something you learned', '✍️', 'online_learning', { difficulty: 2, durationMin: 10 }),
  // Rest / sleep / mental
  A('break_10', 'Take a real 10-min break', '☕', 'rest', { difficulty: 1, durationMin: 10, description: 'No screens. Restores energy.' }),
  A('power_nap', 'Power nap', '💤', 'rest', { difficulty: 1, durationMin: 20, availableOn: 'freeday' }),
  A('screen_free', 'Screen-free half hour', '📵', 'rest', { difficulty: 2, durationMin: 30, stats: { health: 1, discipline: 1 } }),
  A('lie_breathe', 'Lie down and breathe', '🫁', 'rest', { difficulty: 1, durationMin: 5 }),
  A('bed_on_time', 'In bed by bedtime', '🛌', 'sleep', { difficulty: 2, durationMin: 1, timeOfDay: 'night' }),
  A('no_screens_bed', 'No screens 30 min before bed', '🌒', 'sleep', { difficulty: 2, durationMin: 30, timeOfDay: 'night' }),
  A('wake_on_time', 'Wake up on the first alarm', '⏰', 'sleep', { difficulty: 2, durationMin: 1, timeOfDay: 'morning' }),
  A('meditate', 'Meditate', '🧘', 'mental_wellbeing', { difficulty: 1, durationMin: 5, unit: 'min', scalable: { field: 'duration', min: 3, max: 15, step: 2 } }),
  A('gratitude', 'Gratitude: write 3 things', '🙏', 'mental_wellbeing', { difficulty: 1, durationMin: 3, timeOfDay: 'night' }),
  A('breathing', 'Box breathing (2 min)', '🌬️', 'mental_wellbeing', { difficulty: 1, durationMin: 2 }),
  A('journal', 'Journal for 5 minutes', '📓', 'mental_wellbeing', { difficulty: 1, durationMin: 5, timeOfDay: 'night' }),
  A('urge_walk', 'Urge reset: leave the room, walk 5 min', '🚪', 'mental_wellbeing', { difficulty: 1, durationMin: 5, tags: ['nofap_support', 'private'], stats: { discipline: 2 }, description: 'Change the environment, change the impulse.' }),
  A('urge_pushups', 'Urge reset: 15 push-ups', '⚡', 'fitness', { difficulty: 2, durationMin: 3, tags: ['nofap_support', 'private'], stats: { discipline: 1, strength: 1 } }),
  A('urge_cold', 'Urge reset: cold water on face', '🧊', 'mental_wellbeing', { difficulty: 1, durationMin: 2, tags: ['nofap_support', 'private'], stats: { discipline: 1 } }),
  A('phone_out_bedroom', 'Phone charges outside the bedroom', '📵', 'sleep', { difficulty: 2, durationMin: 1, timeOfDay: 'night', tags: ['nofap_support'], stats: { discipline: 2 } }),
  A('digital_sunset', 'Digital sunset', '🌇', 'mental_wellbeing', { difficulty: 2, durationMin: 60, timeOfDay: 'night', description: 'Notifications off for the last hour of the day.' }),
  // Social
  A('message_friend', 'Message a friend', '💬', 'social', { difficulty: 1, durationMin: 5 }),
  A('call_family', 'Call family', '📞', 'social', { difficulty: 1, durationMin: 15 }),
  A('plan_meetup', 'Plan a meetup', '🗓️', 'social', { difficulty: 2, durationMin: 10 }),
  A('compliment', 'Give someone a genuine compliment', '🌟', 'social', { difficulty: 1, durationMin: 2 }),
  A('help_someone', 'Help someone with something small', '🤝', 'social', { difficulty: 2, durationMin: 15 }),
  // General
  A('charge_devices', 'Charge devices for tomorrow', '🔌', 'general', { difficulty: 1, durationMin: 2, timeOfDay: 'night' }),
  A('backup_phone', 'Back up your phone', '☁️', 'general', { difficulty: 1, durationMin: 5, stats: { order: 1 } }),
  A('try_new', 'Try something new today', '🎲', 'general', { difficulty: 2, durationMin: 20, stats: { knowledge: 1 } }),
  A('export_backup', 'Export a LifeForge backup', '💾', 'general', { difficulty: 1, durationMin: 2, description: 'Settings → Data → Export. Cheap insurance.' }),
];
