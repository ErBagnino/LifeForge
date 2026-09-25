import { learnTimes, suggestTimeChanges } from '@/domain/habits';
import { calibrateStepTargets, recommendCalories, recommendProtein, recommendStepTargets } from '@/domain/targets';
import {
  activityRepository,
  questRepository,
  settingsRepository,
  statsRepository,
  suggestionRepository,
} from '@/repositories';
import type { Settings, StepTargets, Suggestion } from '@/types';
import { daysBetween, hmToMinutes, isWeekend, minuteOfDay, shiftDate, weekKey } from '@/utils/date';
import { uid } from '@/utils/id';
import { clock } from './clock';
import type { ServiceResult } from './events';
import { setDayType } from './game/dayService';

const WEEK = 7 * 86400000;

async function offer(s: Omit<Suggestion, 'id' | 'status' | 'createdAt'>): Promise<void> {
  if (await suggestionRepository.wasDeclinedRecently(s.key, clock.now() - WEEK)) return;
  await suggestionRepository.offer({ ...s, id: uid('sg_'), status: 'pending', createdAt: clock.now() });
}

/**
 * Adaptive recommendations (steps, calories, protein, habit times). They are only
 * offered — the user explicitly accepts or declines each one.
 */
export async function refreshSuggestions(): Promise<void> {
  const settings = await settingsRepository.get();
  if (!settings) return;
  const today = clock.today();
  const wk = weekKey(today);
  const logs = (await statsRepository.logs(shiftDate(today, -21), shiftDate(today, -1))).filter((l) => l.closed);

  const last7 = logs.filter((l) => daysBetween(l.date, today) <= 7).map((l) => l.metrics.steps ?? 0);
  const calibration = settings.known.steps !== 'set' ? calibrateStepTargets(last7, settings.safety) : undefined;
  if (calibration) {
    await offer({
      key: 'steps:calibration',
      type: 'stepsTarget',
      title: `Set your step target to ${calibration.next.ideal.toLocaleString('en-US')}?`,
      body: calibration.reason,
      payload: { next: calibration.next },
    });
  }
  const steps = recommendStepTargets(last7, settings.steps, settings.safety);
  if (!calibration && steps.action !== 'keep') {
    await offer({
      key: `steps:${wk}`,
      type: 'stepsTarget',
      title: `Step target → ${steps.next.ideal.toLocaleString('en-US')}?`,
      body: steps.reason,
      payload: { next: steps.next },
    });
  }

  if (settings.tracking.nutrition && settings.tracking.weight) {
    const weights = (await statsRepository.metricsOfType('weight', shiftDate(today, -21), today)).map((m) => ({
      day: daysBetween(shiftDate(today, -21), m.date),
      kg: m.value,
    }));
    const logged = logs.map((l) => l.metrics.calories ?? 0).filter((c) => c > 0);
    const cal = recommendCalories({
      weights,
      loggedCalories: logged,
      adherence: logs.length ? logged.length / logs.length : 0,
      goal: settings.body.goal,
      currentTarget: settings.nutrition.calories,
      bodyWeight: settings.body.weightKg,
      safety: settings.safety,
    });
    if (cal.action !== 'keep') {
      await offer({ key: `calories:${wk}`, type: 'caloriesTarget', title: `Calorie target → ${cal.next} kcal?`, body: `System recommendation: ${cal.reason}`, payload: { next: cal.next } });
    }
    const protein = recommendProtein(settings.nutrition.protein, settings.body.weightKg, settings.safety);
    if (protein.action !== 'keep') {
      await offer({ key: `protein:${protein.next}`, type: 'proteinTarget', title: `Protein target → ${protein.next} g?`, body: `System recommendation: ${protein.reason}`, payload: { next: protein.next } });
    }
  }

  const recent = await questRepository.byRange(shiftDate(today, -45), today);
  const samples = recent
    .filter((q) => q.status === 'completed' && q.activityId && q.completedAt)
    .map((q) => ({ activityId: q.activityId!, minute: q.actualTime ? hmToMinutes(q.actualTime) : minuteOfDay(q.completedAt!), weekend: isWeekend(q.date) }));
  const activities = await activityRepository.all();
  const learned = learnTimes(samples);
  for (const t of suggestTimeChanges(activities, learned).slice(0, 3)) {
    const a = activities.find((x) => x.id === t.activityId);
    if (!a || a.metric) continue;
    await offer({
      key: `time:${t.activityId}:${t.to}`,
      type: 'scheduleTime',
      title: `Move "${a.name.replace(/\{pet\}/g, settings.profile.petName)}" to ${t.to}?`,
      body: t.reason,
      payload: { activityId: t.activityId, to: t.to },
    });
  }
}

export async function pendingSuggestions(): Promise<Suggestion[]> {
  return (await suggestionRepository.pending()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Apply an accepted suggestion. */
export async function acceptSuggestion(id: string): Promise<ServiceResult> {
  const s = await suggestionRepository.get(id);
  const settings = await settingsRepository.get();
  if (!s || !settings || s.status !== 'pending') return { events: [] };
  let next: Settings = settings;
  let result: ServiceResult = { events: [] };
  switch (s.type) {
    case 'stepsTarget':
      next = { ...settings, steps: s.payload.next as StepTargets, known: { ...settings.known, steps: 'set' } };
      break;
    case 'caloriesTarget':
      next = { ...settings, nutrition: { ...settings.nutrition, calories: Number(s.payload.next) } };
      break;
    case 'proteinTarget':
      next = { ...settings, nutrition: { ...settings.nutrition, protein: Number(s.payload.next) } };
      break;
    case 'cardioStage':
      next = { ...settings, cardio: { ...settings.cardio, stageIndex: Number(s.payload.stageIndex), stageStartedOn: clock.today() } };
      break;
    case 'scheduleTime': {
      const a = await activityRepository.get(String(s.payload.activityId));
      if (a) {
        await activityRepository.put({ ...a, preferredTime: String(s.payload.to), updatedAt: clock.now() });
        const todays = (await questRepository.byDate(clock.today())).filter((q) => q.activityId === a.id && q.status === 'pending');
        for (const q of todays) await questRepository.put({ ...q, scheduledTime: String(s.payload.to) });
      }
      break;
    }
    case 'restDay':
      result = await setDayType(String(s.payload.date ?? clock.today()), 'rest', settings);
      break;
    default:
      break;
  }
  if (next !== settings) await settingsRepository.save(next);
  await suggestionRepository.resolve(id, 'accepted');
  result.events.push({ type: 'toast', text: 'Applied. You can change it any time in Settings.', icon: '✅', tone: 'success' });
  return result;
}

export async function declineSuggestion(id: string): Promise<void> {
  await suggestionRepository.resolve(id, 'declined');
}
