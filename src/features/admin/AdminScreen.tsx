import { useNavigate } from 'react-router';
import { Screen } from '@/components/layout/Screen';
import { List, Row } from '@/components/ui/forms';
import { useAsync } from '@/hooks';
import { activityRepository, routineRepository } from '@/repositories';
import { useGame } from '@/store/gameStore';

export default function AdminScreen() {
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const { data } = useAsync(async () => ({ activities: await activityRepository.all(), routines: await routineRepository.all() }), []);
  return (
    <Screen back title="Admin" subtitle="Total control over the system. Changes are saved on this device.">
      <List title="Content">
        <Row icon="📋" iconBg="#ffe3d3" title="Activities" subtitle={`${data?.activities.length ?? '…'} activities · create, edit, pause, delete`} onClick={() => navigate('/admin/activities')} />
        <Row icon="➕" iconBg="#d6f5e6" title="New activity" onClick={() => navigate('/admin/activities/new')} />
        <Row icon="🤖" iconBg="#e8e0ff" title="Create with AI" subtitle="Prompt for ChatGPT / Claude + JSON import" onClick={() => navigate('/admin/ai')} />
        <Row icon="🌅" iconBg="#fff1cc" title="Routines" subtitle={`${data?.routines.length ?? '…'} routines`} onClick={() => navigate('/admin/routines')} />
        <Row icon="🏋️" iconBg="#ffe0e0" title="Workout plan" subtitle="Days, exercises, sets, reps, rest" onClick={() => navigate('/train/plan')} />
        <Row icon="📈" iconBg="#d7ecff" title="Progression rules" subtitle="Per exercise, in each exercise page" onClick={() => navigate('/train/exercises')} />
      </List>
      <List title="Rules & economy">
        <Row icon="📐" iconBg="#ececf0" title="Game rules" subtitle="Score formula, XP, coins, energy, HP, penalties, smart rules" onClick={() => navigate('/admin/rules')} />
        <Row icon="🏰" iconBg="#fdf0dc" title="Tycoon economy" subtitle="Building prices, growth, unlock levels, cosmetics" onClick={() => navigate('/admin/economy')} />
        <Row icon="🎁" iconBg="#ffe5f1" title="Real rewards" subtitle="Define and approve real-world rewards" onClick={() => navigate('/world/shop')} />
        <Row icon="🛡️" iconBg="#fff1cc" title="Safety bounds" onClick={() => navigate('/settings/safety')} />
        <Row icon="🎯" iconBg="#d6f5e6" title="Targets" onClick={() => navigate('/settings/targets')} />
      </List>
      {(settings?.devMode || import.meta.env.DEV) && (
        <List title="Debug">
          <Row icon="🧪" title="Developer toolbox" subtitle="Time travel, simulate days, inspect IndexedDB" onClick={() => navigate('/dev')} />
        </List>
      )}
    </Screen>
  );
}
