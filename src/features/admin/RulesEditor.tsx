import { useEffect, useState } from 'react';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Select, Toggle } from '@/components/ui/forms';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/Sheet';
import { describeRule, FACT_CATALOG, OPERATOR_LABELS } from '@/domain/rulesEngine';
import { resetRules, saveRules } from '@/services/adminService';
import { useGame } from '@/store/gameStore';
import type { GameRules, RuleCondition } from '@/types';
import { labelize } from '@/utils/format';

type Json = number | boolean | string | Json[] | { [k: string]: Json };

const SECTIONS: { key: keyof Omit<GameRules, 'smartRules'>; title: string; help: string }[] = [
  { key: 'score', title: 'Today Score formula', help: 'Weights of each component (0–100 total is not required: components that do not apply are redistributed).' },
  { key: 'xp', title: 'XP', help: 'Base XP per difficulty (1 trivial … 5 boss), reference durations, level & streak scaling, rarity multipliers.' },
  { key: 'coins', title: 'Coins', help: 'Coins ≈ XP × ratio. Streak milestone base.' },
  { key: 'level', title: 'Level curve', help: 'XP to next level = base × level^exponent.' },
  { key: 'energy', title: 'Energy', help: 'Costs per difficulty and how sleep sets the daily starting energy.' },
  { key: 'hp', title: 'HP', help: 'Gains, losses, daily caps and Recovery Mode thresholds.' },
  { key: 'penalties', title: 'Penalties (malus)', help: 'Game consequences only. Coins never go below 0; sick days and Recovery Mode are protected.' },
  { key: 'generator', title: 'Quest generator', help: 'Side quests and max duration per workload level, core caps, rarity weights, reroll cost.' },
  { key: 'adaptive', title: 'Adaptive difficulty', help: 'Thresholds for Too easy / Overloaded / Critical.' },
  { key: 'streak', title: 'Streaks', help: 'Revive window and milestone days.' },
  { key: 'difficultyPresets', title: 'Difficulty presets', help: 'Reward/penalty multipliers and streak line per difficulty.' },
];

function Editor({ value, onChange, path = '' }: { value: Json; onChange: (v: Json) => void; path?: string }) {
  if (typeof value === 'number') return <NumberInput value={value} onChange={(v) => onChange(v)} step={Number.isInteger(value) ? 1 : 0.01} aria-label={path} className="!h-11" />;
  if (typeof value === 'boolean') return <Toggle checked={value} onChange={onChange} label={path} />;
  if (Array.isArray(value)) {
    return (
      <input
        className="h-10 w-full rounded-2xl border border-line bg-surface px-3 text-[15px]"
        defaultValue={value.join(', ')}
        aria-label={path}
        onBlur={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n)),
          )
        }
      />
    );
  }
  if (typeof value === 'object' && value !== null) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className={typeof v === 'object' && !Array.isArray(v) ? 'col-span-2 rounded-2xl bg-surface-2 p-2' : ''}>
            <div className="mb-1 px-1 text-[12px] font-semibold text-muted">{labelize(k)}</div>
            <Editor value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} path={`${path}.${k}`} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-[13px]">{String(value)}</span>;
}

export default function RulesEditor() {
  const settings = useGame((s) => s.settings);
  const refresh = useGame((s) => s.refresh);
  const [rules, setRules] = useState<GameRules | null>(null);
  const [open, setOpen] = useState<string | null>('score');
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (settings) setRules(structuredClone(settings.rules));
  }, [settings]);
  if (!rules) return null;
  const weights = Object.values(rules.score.weights).reduce((a, b) => a + b, 0);
  const setCondition = (ri: number, ci: number, c: RuleCondition) =>
    setRules({ ...rules, smartRules: rules.smartRules.map((r, i) => (i === ri ? { ...r, conditions: r.conditions.map((x, j) => (j === ci ? c : x)) } : r)) });

  return (
    <Screen back title="Game rules" subtitle="The whole game is data. Tweak carefully — or reset to defaults.">
      {SECTIONS.map((s) => (
        <div key={s.key}>
          <SectionTitle action={<button type="button" className="hit-44 text-[13px] font-semibold text-accent" onClick={() => setOpen(open === s.key ? null : s.key)}>{open === s.key ? 'Close' : 'Edit'}</button>}>
            {s.title}
          </SectionTitle>
          {open === s.key && (
            <Card>
              <p className="mb-3 text-[12px] text-muted">{s.help}</p>
              {s.key === 'score' && <p className="mb-2 text-[12px] font-semibold">Total weight: {weights}</p>}
              <Editor value={rules[s.key] as unknown as Json} onChange={(v) => { setSaved(false); setRules({ ...rules, [s.key]: v }); }} path={s.key} />
            </Card>
          )}
        </div>
      ))}

      <SectionTitle>Smart rules engine</SectionTitle>
      <p className="mb-2 px-1 text-[12px] text-muted">Centralized IF → THEN rules evaluated on day start, quest completion, workouts and day end.</p>
      <div className="space-y-2">
        {rules.smartRules.map((r, ri) => (
          <Card key={r.id} className="!p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-bold">{r.name}</div>
                <div className="text-[12px] text-muted">{r.description}</div>
              </div>
              <Toggle checked={r.enabled} label={r.name} onChange={(v) => setRules({ ...rules, smartRules: rules.smartRules.map((x, i) => (i === ri ? { ...x, enabled: v } : x)) })} />
            </div>
            <div className="mt-2 rounded-xl bg-surface-2 p-2 font-mono text-[11px] text-muted">{describeRule(r)}</div>
            <div className="mt-2 space-y-1.5">
              {r.conditions.map((c, ci) => (
                <div key={ci} className="grid grid-cols-[1fr_78px_76px] gap-1.5">
                  <Select value={c.fact} onChange={(v) => setCondition(ri, ci, { ...c, fact: v })} options={Object.entries(FACT_CATALOG).map(([k, f]) => ({ value: k, label: f.label }))} aria-label="Fact" className="!h-11 !text-[13px]" />
                  <Select value={c.op} onChange={(v) => setCondition(ri, ci, { ...c, op: v })} options={Object.entries(OPERATOR_LABELS).map(([k, l]) => ({ value: k as RuleCondition['op'], label: l }))} aria-label="Operator" className="!h-11 !pr-7 !pl-3" />
                  {typeof c.value === 'boolean' ? (
                    <Select value={String(c.value)} onChange={(v) => setCondition(ri, ci, { ...c, value: v === 'true' })} options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} aria-label="Value" className="!h-11" />
                  ) : (
                    <NumberInput value={Number(c.value)} onChange={(v) => setCondition(ri, ci, { ...c, value: v })} step={0.1} aria-label="Value" className="!h-11 !px-2" />
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Button
        block
        size="lg"
        className="mt-5"
        onClick={async () => {
          await saveRules(rules);
          await refresh();
          setSaved(true);
        }}
      >
        {saved ? 'Saved ✓' : 'Save rules'}
      </Button>
      <Button block variant="danger" className="mt-2" onClick={() => setConfirmReset(true)}>
        Reset all rules to defaults
      </Button>
      <Field label="">
        <p className="mt-2 px-1 text-[11px] text-muted">Rules apply from the next action / next day. Existing quests keep their rewards.</p>
      </Field>
      <Dialog
        open={confirmReset}
        title="Reset game rules?"
        message="Your activities and progress are not touched."
        confirmLabel="Reset"
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetRules();
          await refresh();
          setConfirmReset(false);
        }}
      />
    </Screen>
  );
}
