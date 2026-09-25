import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { Field, NumberInput, Select, Stepper, TextArea, TextInput, Toggle } from '@/components/ui/forms';
import { Button, Card, Chip, SectionTitle } from '@/components/ui/primitives';
import { CATEGORY_INFO } from '@/data/categories';
import { computeQuestValues } from '@/domain/rewards';
import { describeRecurrence } from '@/domain/recurrence';
import { useAsync, useLevel } from '@/hooks';
import { activityRepository } from '@/repositories';
import { importActivities } from '@/services/adminService';
import { buildAiPrompt, type ImportDraft, parseAiResponse } from '@/services/aiImportService';
import { useGame } from '@/store/gameStore';
import { CATEGORIES } from '@/types';

export default function AiImportScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const act = useGame((s) => s.act);
  const { level } = useLevel();
  const [request, setRequest] = useState('');
  const [count, setCount] = useState(3);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const { data: existing } = useAsync(() => activityRepository.all(), []);
  if (!settings) return null;

  const prompt = buildAiPrompt({ request, existingNames: (existing ?? []).map((a) => a.name), petName: settings.profile.petName, count });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const parse = () => {
    const r = parseAiResponse(pasted, (existing ?? []).map((a) => a.id));
    setErrors(r.errors);
    setDrafts(r.drafts);
    setSelected(Object.fromEntries(r.drafts.map((d) => [d.activity.id, d.warnings.length === 0])));
  };
  const chosen = drafts.filter((d) => selected[d.activity.id]);
  const needsAck = chosen.some((d) => d.warnings.length > 0);

  return (
    <Screen back title="Create with AI" subtitle="No API, no data sent anywhere: copy a prompt into ChatGPT, Claude or any AI, then paste the JSON back.">
      <SectionTitle>1 · Describe what you want</SectionTitle>
      <TextArea value={request} onChange={setRequest} placeholder="e.g. I want to start learning Spanish and read more online articles about design" rows={3} aria-label="What do you want" />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[14px] text-muted">How many activities?</span>
        <Stepper label="Count" value={count} onChange={setCount} min={1} max={10} size="sm" />
      </div>

      <SectionTitle>2 · Copy the prompt</SectionTitle>
      <Card>
        <pre className="max-h-40 overflow-auto rounded-xl bg-surface-2 p-2 text-[11px] whitespace-pre-wrap text-muted">{prompt}</pre>
        <Button block className="mt-2" icon="copy" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy prompt'}
        </Button>
      </Card>

      <SectionTitle>3 · Paste the AI's JSON</SectionTitle>
      <TextArea value={pasted} onChange={setPasted} placeholder='[{"name": "Read online", "category": "reading", ...}]' rows={6} aria-label="Paste JSON" className="font-mono !text-[13px]" />
      <Button block size="lg" className="mt-2" disabled={!pasted.trim()} onClick={parse}>
        Validate
      </Button>
      {errors.length > 0 && (
        <Card className="mt-3 border border-danger/30">
          <div className="text-[14px] font-bold text-danger">The JSON doesn't match the schema</div>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-muted">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Card>
      )}

      {drafts.length > 0 && (
        <>
          <SectionTitle>4 · Preview & edit</SectionTitle>
          <div className="space-y-2">
            {drafts.map((d, i) => {
              const a = d.activity;
              const v = computeQuestValues({ difficulty: a.difficulty, durationMin: a.durationMin, importance: a.importance, recurrence: a.recurrence, rarity: 'common', category: a.category, baseXp: a.baseXp, baseCoins: a.baseCoins }, level, settings.rules);
              const update = (patch: Partial<typeof a>) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, activity: { ...x.activity, ...patch } } : x)));
              return (
                <Card key={a.id} className="space-y-2 !p-3">
                  <div className="flex items-center gap-2">
                    <Toggle checked={!!selected[a.id]} onChange={(val) => setSelected({ ...selected, [a.id]: val })} label={`Import ${a.name}`} />
                    <span className="text-[22px]">{a.icon}</span>
                    <TextInput value={a.name} onChange={(val) => update({ name: val })} aria-label="Name" className="!h-11" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip>{describeRecurrence(a)}</Chip>
                    <Chip>{a.durationMin} min</Chip>
                    <Chip color="#7c5cff">+{v.xp} XP</Chip>
                    <Chip color="#f5a400">+{v.coins} 🪙</Chip>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Category">
                      <Select value={a.category} onChange={(val) => update({ category: val })} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_INFO[c].label }))} aria-label="Category" className="!h-11" />
                    </Field>
                    <Field label="Difficulty">
                      <NumberInput value={a.difficulty} onChange={(val) => update({ difficulty: Math.min(5, Math.max(1, Math.round(val))) as typeof a.difficulty })} aria-label="Difficulty" className="!h-11" />
                    </Field>
                  </div>
                  {d.warnings.map((w, k) => (
                    <p key={k} className="rounded-xl bg-warn/10 px-2 py-1.5 text-[12px] text-warn">
                      ⚠️ {w}
                    </p>
                  ))}
                </Card>
              );
            })}
          </div>
          {needsAck && (
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <Toggle checked={ack} onChange={setAck} label="I understand" /> I understand the warnings and still want to import.
            </label>
          )}
          <Button
            block
            size="lg"
            className="mt-3"
            disabled={!chosen.length || (needsAck && !ack)}
            onClick={async () => {
              await act(importActivities(chosen.map((d) => d.activity)));
              navigate('/admin/activities');
            }}
          >
            Import {chosen.length} activit{chosen.length === 1 ? 'y' : 'ies'}
          </Button>
        </>
      )}
    </Screen>
  );
}
