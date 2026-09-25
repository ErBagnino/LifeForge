import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { List, Row } from '@/components/ui/forms';
import { APP_CONFIG } from '@/config/app';
import { saveSettings } from '@/services/adminService';
import { useGame } from '@/store/gameStore';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const refresh = useGame((s) => s.refresh);
  const [taps, setTaps] = useState(0);
  if (!settings) return null;
  const go = (section: string) => () => navigate(`/settings/${section}`);
  return (
    <Screen back title="Settings">
      <List>
        <Row icon="🙂" iconBg="#ffe3d3" title="Profile" subtitle={`${settings.profile.nickname} · pet: ${settings.profile.petName}`} onClick={go('profile')} />
        <Row icon="🎨" iconBg="#e8e0ff" title="Appearance" subtitle={`${settings.theme} · ${settings.accent}`} onClick={go('appearance')} />
        <Row icon="🎮" iconBg="#ffe0e0" title="Game" subtitle={`Difficulty ${settings.difficulty} · coach ${settings.tone}`} onClick={go('game')} />
      </List>
      <List title="Your life">
        <Row icon="🕰️" iconBg="#d7ecff" title="Schedule" subtitle={`Wake ${settings.schedule.wake} · sleep ${settings.schedule.sleep}`} onClick={go('schedule')} />
        <Row icon="🎯" iconBg="#d6f5e6" title="Targets" subtitle="Nutrition, steps, water, play time, cardio" onClick={go('targets')} />
        <Row icon="🛡️" iconBg="#fff1cc" title="Safety bounds" subtitle="Limits for every adaptive change" onClick={go('safety')} />
      </List>
      <List title="System">
        <Row icon="🔔" iconBg="#ffe3d3" title="Notifications" subtitle={settings.notifications.enabled ? 'On' : 'Off'} onClick={go('notifications')} />
        <Row icon="💾" iconBg="#e3f4ff" title="Data" subtitle="Export / import JSON backup" onClick={go('data')} />
        <Row icon="🛠️" iconBg="#ececf0" title="Admin" subtitle="Activities, rules, economy, AI import" onClick={() => navigate('/admin')} />
        {settings.devMode && <Row icon="🧪" title="Developer toolbox" onClick={() => navigate('/dev')} />}
      </List>
      <button
        type="button"
        className="mt-6 w-full text-center text-[12px] text-muted"
        onClick={async () => {
          const n = taps + 1;
          setTaps(n);
          if (n >= 7 && !settings.devMode) {
            await saveSettings({ ...settings, devMode: true });
            await refresh();
          }
        }}
      >
        {APP_CONFIG.displayName} v{APP_CONFIG.version} · data stays on this device
        {taps >= 3 && !settings.devMode ? ` · ${7 - taps} taps to developer mode` : ''}
      </button>
    </Screen>
  );
}
