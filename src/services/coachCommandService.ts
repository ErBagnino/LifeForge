import type { CoachCommand, MemoryIntent } from '@/domain/coachCommands';
import { playerRepository, questRepository, settingsRepository } from '@/repositories';
import type { Quest } from '@/types';
import { formatDate, shiftDate } from '@/utils/date';
import { formatDuration } from '@/utils/format';
import { clock } from './clock';
import type { QuickReply } from '@/domain/coachAssistant';
import type { InfoLine } from './coachService';
import { addMemory, forgetMatching, listMemory } from './coachMemoryService';
import { contextSnapshot } from './contextService';
import { resolveText } from './game/questFactory';
import { tomorrowForecast } from './insightsService';

/** Answers for on-device Coach commands. Only real data; when data is missing, say so. */
export interface CommandAnswer {
  text: string;
  info?: InfoLine[];
  quick?: QuickReply[];
}

const TIER_ICON = { core: '⭐', important: '🔷', optional: '✨' } as const;

function line(q: Quest, pet: string, value?: string): InfoLine {
  return { icon: q.private ? '🛡️' : q.icon, label: q.private ? 'Private quest' : resolveText(q.title, pet), value: value ?? `${q.durationMin} min · ${TIER_ICON[q.tier]}` };
}

export async function answerCommand(cmd: CoachCommand): Promise<CommandAnswer> {
  const settings = await settingsRepository.get();
  const pet = settings?.profile.petName ?? 'Sky';
  const today = clock.today();
  switch (cmd) {
    case 'right_now': {
      const snap = await contextSnapshot();
      if (!snap) return { text: 'I can’t read today yet — open the Today tab once and ask again.' };
      if (snap.openWork) return { text: 'You’re at work right now, so quests are on hold. When you tap END WORK I’ll suggest the best next step.' };
      if (snap.view.state === 'SLEEP' || snap.view.state === 'WIND_DOWN') return { text: 'It’s wind-down time. The best move now is rest — anything left can wait for tomorrow without breaking anything.' };
      const next = snap.view.decisions.find((d) => !d.suspended && d.realistic) ?? snap.view.decisions.find((d) => !d.suspended);
      if (!next) return { text: 'Nothing is pending right now. Enjoy the free time — or open the quest library for bonus XP.' };
      const alt = next.alternative ? ` Low on energy? ${next.alternative.label} (${next.alternative.durationMin} min) counts too.` : '';
      return { text: `Do this now: ${resolveText(next.quest.title, pet)}. ${next.reason}.${alt}`, info: [line(next.quest, pet)] };
    }
    case 'time_left': {
      const snap = await contextSnapshot();
      if (!snap) return { text: 'I can’t read today yet — open the Today tab once and ask again.' };
      const v = snap.view;
      if (v.minutesToBed <= 0) return { text: 'Your planned bedtime has passed, so there is no free time left in today’s plan. Rest counts.' };
      const info: InfoLine[] = [
        { icon: '🛏️', label: 'Until bedtime', value: formatDuration(v.minutesToBed) },
        { icon: '💼', label: 'Still busy', value: v.busyAhead ? formatDuration(v.busyAhead) : 'nothing planned' },
        { icon: '⏳', label: 'Realistically free', value: formatDuration(v.availableMin) },
        { icon: '📋', label: 'Pending quests need', value: formatDuration(v.plannedMin) },
      ];
      const verdict = v.fits ? 'Everything still pending fits — no rush.' : `That’s ${formatDuration(Math.max(0, v.plannedMin - v.availableMin))} more than you have, so focus on the core ones; the rest can move without penalty.`;
      return { text: `You have about ${formatDuration(v.availableMin)} of real free time left today. ${verdict}`, info };
    }
    case 'plan_evening': {
      const snap = await contextSnapshot();
      if (!snap) return { text: 'I can’t read today yet — open the Today tab once and ask again.' };
      // The evening starts at 18:00 (or now, if later); keep 30 minutes free to wind down.
      const nowDate = new Date(clock.now());
      const toSix = Math.max(0, (18 - nowDate.getHours()) * 60 - nowDate.getMinutes());
      const early = toSix > 0 && nowDate.getHours() >= (settings?.dayStartHour ?? 4);
      const eveningMin = early ? Math.min(snap.view.availableMin, Math.max(0, snap.view.minutesToBed - toSix)) : snap.view.availableMin;
      const budget = Math.max(0, eveningMin - 30);
      const picks: Quest[] = [];
      let used = 0;
      for (const d of snap.view.decisions) {
        if (d.suspended) continue;
        const min = d.quest.durationMin || 5;
        if (used + min > budget && picks.length) continue;
        if (used + min > budget + 10) continue;
        picks.push(d.quest);
        used += min;
        if (picks.length >= 5) break;
      }
      if (!picks.length) return { text: budget <= 0 ? 'Tonight is for winding down — there isn’t realistic time left, and that’s fine.' : 'Nothing is pending for tonight. Free evening! 🎉' };
      return {
        text: `${early ? 'For this evening (from 18:00): ' : 'Here’s a realistic evening: '}${formatDuration(used)} of about ${formatDuration(eveningMin)} free, most important first, with 30 min kept free to wind down:`,
        info: picks.map((q) => line(q, pet)),
      };
    }
    case 'prepare_tomorrow': {
      const f = await tomorrowForecast();
      if (!f) return { text: 'I can’t build tomorrow’s preview yet.' };
      const pending = (await questRepository.byDate(shiftDate(today, 1))).filter((q) => q.status === 'pending');
      const info: InfoLine[] = [
        { icon: '📅', label: formatDate(f.date, 'EEEE d MMM'), value: f.dayType === 'rest' ? 'Rest day' : f.dayType === 'work' ? 'Workday' : 'Free day' },
        { icon: '📋', label: 'Expected quests', value: String(f.questCount) },
        { icon: '⚖️', label: 'Expected load', value: `${f.workload.score} · ${f.workload.level}` },
      ];
      if (f.workout) info.push({ icon: '🏋️', label: 'Workout', value: f.workout });
      for (const q of pending.slice(0, 4)) info.push(line(q, pet, q.scheduledTime ?? 'already planned'));
      const tip = f.workload.level === 'high' ? 'It looks heavy: lay out clothes and prep food tonight so tomorrow starts easy.' : 'Looks manageable. A good night’s sleep is the best prep.';
      return { text: `Tomorrow at a glance. ${tip}`, info, quick: [{ label: 'Tomorrow I work…', value: 'text:Tomorrow I work 9-18' }] };
    }
    case 'postponed': {
      const range = await questRepository.byRange(today, shiftDate(today, 14));
      const list = range.filter((q) => q.status === 'pending' && !q.hidden && (q.rescheduleCount > 0 || q.snoozeCount > 0)).sort((a, b) => a.date.localeCompare(b.date));
      if (!list.length) return { text: 'Nothing postponed. Your board is clean 🙌' };
      return {
        text: `You have ${list.length} postponed ${list.length === 1 ? 'quest' : 'quests'}. Moving things is never a failure — pick one to do or let it go:`,
        info: list.slice(0, 8).map((q) => line(q, pet, q.date === today ? `today${q.scheduledTime ? ` ${q.scheduledTime}` : ''}` : formatDate(q.date, 'EEE d MMM'))),
      };
    }
    case 'bad_day': {
      const [player, quests] = await Promise.all([playerRepository.get(), questRepository.byDate(today)]);
      const core = quests.filter((q) => q.tier === 'core' && q.status === 'pending' && !q.hidden).sort((a, b) => a.durationMin - b.durationMin);
      const small = core.slice(0, 2);
      const text = [
        'Bad days happen to everyone — one day never erases your progress.',
        small.length ? `If you have a little energy, just do the smallest ${small.length === 1 ? 'thing' : 'two things'} below. That’s a win today.` : 'Your core quests are already done, so today is already a win. Rest.',
        player?.streak.current ? `Your ${player.streak.current}-day streak is safe if the core is done; a streak freeze protects it otherwise.` : 'Tomorrow is a fresh start at 04:00.',
      ].join(' ');
      return { text, info: small.map((q) => line(q, pet)), quick: [{ label: 'Make today lighter', value: 'text:Make today lighter' }] };
    }
  }
}

export async function answerMemory(intent: MemoryIntent): Promise<CommandAnswer> {
  switch (intent.kind) {
    case 'remember': {
      const r = await addMemory(intent.text);
      return { text: r.ok ? `${r.message} “${r.note!.text}” — you can edit or delete it in Settings → Coach memory.` : r.message };
    }
    case 'recall': {
      const notes = await listMemory();
      if (!notes.length) return { text: 'I don’t have any notes yet. Say “Remember that…” and I’ll keep it on this device.' };
      return { text: `I remember ${notes.length} ${notes.length === 1 ? 'thing' : 'things'} (only on this device):`, info: notes.map((n) => ({ icon: '📝', label: n.text })) };
    }
    case 'forget': {
      const removed = await forgetMatching(intent.query);
      return { text: removed.length ? `Forgotten: ${removed.map((n) => `“${n.text}”`).join(', ')}.` : `I couldn’t find a note about “${intent.query}”. Settings → Coach memory shows everything I keep.` };
    }
  }
}
