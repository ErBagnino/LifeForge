import { useState } from 'react';
import { Field, List, Row, Select, TextInput, Toggle } from '@/components/ui/forms';
import { Button, Card } from '@/components/ui/primitives';
import { saveSettings } from '@/services/adminService';
import { type AiModel, defaultModel, getApiKey, listModels, setApiKey } from '@/services/ai/claude';
import { useGame } from '@/store/gameStore';

const VOICE_LANGS = [
  { value: '', label: 'Device language' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
];

export function CoachPanel() {
  const settings = useGame((s) => s.settings)!;
  const refresh = useGame((s) => s.refresh);
  const [key, setKey] = useState(getApiKey());
  const [models, setModels] = useState<AiModel[]>(settings.coach.ai.model ? [{ id: settings.coach.ai.model, name: settings.coach.ai.model }] : []);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const saveCoach = async (patch: Partial<typeof settings.coach>) => {
    await saveSettings({ ...settings, coach: { ...settings.coach, ...patch } });
    await refresh();
  };

  const connect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      setApiKey(key);
      const list = await listModels(key.trim());
      setModels(list);
      const model = settings.coach.ai.model && list.some((m) => m.id === settings.coach.ai.model) ? settings.coach.ai.model : defaultModel(list);
      await saveCoach({ ai: { enabled: true, model } });
      setStatus({ tone: 'ok', text: `Connected · ${list.length} models available.` });
    } catch (e) {
      setStatus({ tone: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <List title="Voice">
        <Row title="Voice input language" right={<Select value={settings.coach.voiceLang} onChange={(v) => void saveCoach({ voiceLang: v })} options={VOICE_LANGS} aria-label="Voice language" className="!h-11 w-[170px]" />} />
      </List>
      <p className="mt-1.5 px-4 text-[12px] text-muted">If the mic button isn’t available on your device, the 🎙️ key on the iPhone keyboard works in the chat too.</p>

      <Card className="mt-5">
        <div className="text-[16px] font-bold">How the Coach works</div>
        <p className="mt-1 text-[14px] text-muted">
          The Coach understands schedule, availability, goals and body updates on your device, in Italian and English — no internet, no account. Every change is shown as a preview and only applied when you tap APPLY.
        </p>
      </Card>

      <List title="Optional: AI for everything else" footer="With your own Anthropic API key, messages the on-device Coach doesn’t understand — and food photos you choose to analyze — are sent directly from this device to Anthropic’s API. Nothing else leaves the device. The key is stored only in this browser (not in backups).">
        <div className="space-y-3 p-4">
          <Field label="API key">
            <TextInput value={key} onChange={setKey} type="password" placeholder="sk-ant-…" aria-label="API key" />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" loading={busy} disabled={!key.trim()} onClick={() => void connect()}>
              Connect
            </Button>
            {getApiKey() && (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={async () => {
                  setApiKey('');
                  setKey('');
                  await saveCoach({ ai: { enabled: false, model: '' } });
                  setStatus(null);
                }}
              >
                Remove key
              </Button>
            )}
          </div>
          {status && <p className={status.tone === 'ok' ? 'text-[13px] font-semibold text-success' : 'text-[13px] font-semibold text-danger'}>{status.text}</p>}
        </div>
        {models.length > 0 && (
          <>
            <Row title="Model" right={<Select value={settings.coach.ai.model} onChange={(v) => void saveCoach({ ai: { ...settings.coach.ai, model: v } })} options={models.map((m) => ({ value: m.id, label: m.name }))} aria-label="Model" className="!h-11 w-[190px]" />} />
            <Row title="Use AI fallback" subtitle="Off = on-device only" right={<Toggle checked={settings.coach.ai.enabled} onChange={(v) => void saveCoach({ ai: { ...settings.coach.ai, enabled: v } })} label="Use AI fallback" />} />
          </>
        )}
      </List>
    </div>
  );
}
