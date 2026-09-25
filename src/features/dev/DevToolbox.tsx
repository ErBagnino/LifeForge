import { useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Select } from '@/components/ui/forms';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { useAsync } from '@/hooks';
import { achievementRepository, getDb } from '@/repositories';
import { saveSettings, tableCounts } from '@/services/adminService';
import { clock } from '@/services/clock';
import {
  devAddCoins,
  devAddXp,
  devCompleteRandomQuest,
  devFailRandomQuest,
  devResetDay,
  devSetClockOffset,
  devShiftDays,
  devSimulateDay,
  devSimulateWeek,
  devSimulateWorkout,
  devTestNotification,
  devUnlockAchievement,
} from '@/services/devService';
import type { GameEvent } from '@/services/events';
import { useGame } from '@/store/gameStore';

export default function DevToolbox() {
  const settings = useGame((s) => s.settings);
  const refresh = useGame((s) => s.refresh);
  const pushFx = useGame((s) => s.pushFx);
  const act = useGame((s) => s.act);
  const [amount, setAmount] = useState(500);
  const [busy, setBusy] = useState('');
  const [table, setTable] = useState('player');
  const [rows, setRows] = useState<string>('');
  const [ach, setAch] = useState('');
  const { data: counts, reload } = useAsync(() => tableCounts(), []);
  const { data: achievements } = useAsync(async () => (await achievementRepository.all()).filter((a) => !a.unlockedAt), []);
  if (!settings) return null;

  const run = async (label: string, fn: () => Promise<GameEvent[] | string | void>) => {
    setBusy(label);
    try {
      const r = await fn();
      await refresh();
      if (Array.isArray(r)) pushFx(...r.slice(-12));
      reload();
    } finally {
      setBusy('');
    }
  };
  const offsetDays = Math.round((clock.getOffset() / 86400000) * 10) / 10;

  return (
    <Screen back title="Developer toolbox" subtitle="Hidden unless dev mode is on. Everything acts on your real local data.">
      <SectionTitle>Economy</SectionTitle>
      <Card className="space-y-2">
        <Field label="Amount">
          <NumberInput value={amount} onChange={setAmount} aria-label="Amount" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button loading={busy === 'xp'} onClick={() => void run('xp', () => devAddXp(amount))}>
            + XP
          </Button>
          <Button loading={busy === 'coins'} onClick={() => void run('coins', () => devAddCoins(amount))}>
            + Coins
          </Button>
        </div>
      </Card>

      <SectionTitle>Time</SectionTitle>
      <Card className="space-y-2">
        <div className="text-[13px] text-muted">
          Game date: <span className="font-bold text-fg">{clock.today()}</span> · offset {offsetDays} days
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" loading={busy === '-1'} onClick={() => void run('-1', () => devShiftDays(-1))}>
            −1 day
          </Button>
          <Button variant="secondary" loading={busy === '+1'} onClick={() => void run('+1', () => devShiftDays(1))}>
            +1 day
          </Button>
          <Button variant="secondary" loading={busy === '+1h'} onClick={() => void run('+1h', () => devSetClockOffset(clock.getOffset() + 3600000))}>
            +1 hour
          </Button>
        </div>
        <Button block variant="secondary" loading={busy === 'reset'} onClick={() => void run('reset', () => devSetClockOffset(0))}>
          Back to real time
        </Button>
      </Card>

      <SectionTitle>Simulation</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button loading={busy === 'day'} onClick={() => void run('day', () => devSimulateDay())}>
          Simulate day
        </Button>
        <Button loading={busy === 'week'} onClick={() => void run('week', () => devSimulateWeek())}>
          Simulate week
        </Button>
        <Button variant="secondary" loading={busy === 'workout'} onClick={() => void run('workout', () => devSimulateWorkout())}>
          Simulate workout
        </Button>
        <Button variant="secondary" loading={busy === 'resetday'} onClick={() => void run('resetday', () => devResetDay())}>
          Reset today
        </Button>
        <Button variant="secondary" loading={busy === 'cq'} onClick={() => void run('cq', () => devCompleteRandomQuest())}>
          Complete a quest
        </Button>
        <Button variant="secondary" loading={busy === 'fq'} onClick={() => void run('fq', () => devFailRandomQuest())}>
          Fail a quest
        </Button>
        <Button variant="secondary" loading={busy === 'n'} onClick={() => void run('n', async () => void (await devTestNotification()))}>
          Test notification
        </Button>
        <Button variant="secondary" onClick={() => pushFx({ type: 'levelUp', level: 42, perks: [{ type: 'coins', amount: 230 }] })}>
          Preview level-up
        </Button>
      </div>

      <SectionTitle>Achievements</SectionTitle>
      <Card className="space-y-2">
        <Select value={ach} onChange={setAch} options={[{ value: '', label: 'Pick a locked achievement…' }, ...(achievements ?? []).map((a) => ({ value: a.id, label: `${a.icon} ${a.name}` }))]} aria-label="Achievement" />
        <Button block disabled={!ach} onClick={() => void run('ach', () => devUnlockAchievement(ach))}>
          Unlock
        </Button>
      </Card>

      <SectionTitle>IndexedDB</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          {Object.entries(counts ?? {}).map(([t, n]) => (
            <button key={t} type="button" className="flex justify-between text-left" onClick={() => setTable(t)}>
              <span className={t === table ? 'font-bold text-accent' : ''}>{t}</span>
              <span className="num text-muted">{n}</span>
            </button>
          ))}
        </div>
        <Button
          block
          variant="secondary"
          className="mt-3"
          onClick={async () => {
            const data = await getDb().table(table).limit(20).toArray();
            setRows(JSON.stringify(data, null, 2));
          }}
        >
          Inspect “{table}” (first 20)
        </Button>
        {rows && <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-2 p-2 text-[10px]">{rows}</pre>}
      </Card>

      <SectionTitle>Mode</SectionTitle>
      <Button
        block
        variant="danger"
        onClick={async () => {
          await saveSettings({ ...settings, devMode: false });
          await act(Promise.resolve({ events: [] }));
        }}
      >
        Turn off developer mode
      </Button>
    </Screen>
  );
}
