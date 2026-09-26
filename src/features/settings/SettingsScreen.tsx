import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { List, Row } from '@/components/ui/forms';
import { APP_CONFIG } from '@/config/app';
import { profileFields } from '@/domain/profile';
import { saveSettings } from '@/services/adminService';
import { clock } from '@/services/clock';
import { startTutorial } from '@/features/tutorial/Tutorial';
import { useAi } from '@/store/aiStore';
import { useGame } from '@/store/gameStore';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const refresh = useGame((s) => s.refresh);
  const [taps, setTaps] = useState(0);
  const ui = useAi((s) => s.ui);
  if (!settings) return null;
  const go = (section: string) => () => navigate(`/settings/${section}`);
  const fields = profileFields(settings, clock.today());
  const aiLabel = { connected: 'connected', connecting: 'checking…', quota: 'limit reached', not_connected: 'not connected', invalid_key: 'invalid key', server_error: 'server error', error: 'error', offline: 'offline' }[ui];
  return (
    <Screen back title="Settings">
      <List>
        <Row icon="🙂" iconBg="#ffe3d3" title="Profile" subtitle={`${settings.profile.nickname} · ${fields.filter((f) => f.status === 'set').length}/${fields.filter((f) => f.status !== 'optional').length} info set`} onClick={go('profile')} />
        <Row icon="🎨" iconBg="#e8e0ff" title="Appearance" subtitle={`${settings.theme} · ${settings.accent}`} onClick={go('appearance')} />
        <Row icon="🎮" iconBg="#ffe0e0" title="Game" subtitle={`Difficulty ${settings.difficulty} · coach ${settings.tone}`} onClick={go('game')} />
      </List>
      <List title="Your life">
        <Row icon="🕰️" iconBg="#d7ecff" title="Schedule" subtitle={`Work: ${fields.find((f) => f.key === 'work')?.value ?? 'Not set'}`} onClick={go('schedule')} />
        <Row icon="💬" iconBg="#e8e0ff" title="Configure with the Coach" subtitle="“From Monday I work 9–18”, “no gym this week”…" onClick={() => navigate('/coach')} />
        <Row icon="🎯" iconBg="#d6f5e6" title="Targets" subtitle="Nutrition, steps, water, play time, cardio" onClick={go('targets')} />
        <Row icon="🛡️" iconBg="#fff1cc" title="Safety bounds" subtitle="Limits for every adaptive change" onClick={go('safety')} />
      </List>
      <List title="System">
        <Row icon="🔔" iconBg="#ffe3d3" title="Notifications" subtitle={settings.notifications.enabled ? 'On' : 'Off'} onClick={go('notifications')} />
        <Row icon="✨" iconBg="#ececf0" title="AI" subtitle={settings.coach.ai.enabled ? `Gemini · ${aiLabel} · usage` : 'Off · basic coach'} onClick={go('ai')} />
        <Row icon="💾" iconBg="#e3f4ff" title="Data" subtitle="Export / import JSON backup" onClick={go('data')} />
        <Row icon="🧭" iconBg="#d6f5e6" title="Help" subtitle="Replay the interactive tour" onClick={() => startTutorial()} />
        <Row icon="🛠️" iconBg="#ececf0" title="Admin" subtitle="Activities, rules, economy, AI import" onClick={() => navigate('/admin')} />
        {settings.devMode && <Row icon="🧪" title="Developer toolbox" onClick={() => navigate('/dev')} />}
      </List>
      <button
        type="button"
        className="mt-4 min-h-11 w-full text-center text-[12px] text-muted"
        onClick={async () => {
          const n = taps + 1;
          setTaps(n);
          if (n >= 7 && !settings.devMode) {
            await saveSettings({ ...settings, devMode: true });
            await refresh();
          }
        }}
      >
        {APP_CONFIG.displayName} v{APP_CONFIG.version} · game data stays on this device
        {taps >= 3 && !settings.devMode ? ` · ${7 - taps} taps to developer mode` : ''}
      </button>
    </Screen>
  );
}
