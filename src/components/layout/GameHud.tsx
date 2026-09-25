import { useState } from 'react';
import { useNavigate } from 'react-router';
import { classById, computeClassAffinities } from '@/domain/classes';
import { useLevel } from '@/hooks';
import { useGame } from '@/store/gameStore';
import { formatInt } from '@/utils/format';
import { Avatar } from '../game/Avatar';
import { Flame } from '../game/bits';
import { Icon } from '../ui/Icon';
import { AnimatedNumber, ProgressBar } from '../ui/progress';
import { Sheet } from '../ui/Sheet';
import { Row, List } from '../ui/forms';

function Meter({ icon, value, max, color, label, id }: { icon: string; value: number; max: number; color: string; label: string; id?: string }) {
  return (
    <div id={id} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-2xl bg-surface-2 px-2.5 py-1.5" aria-label={`${label} ${Math.round(value)} of ${max}`}>
      <span aria-hidden className="text-[14px]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="num text-[13px] leading-none font-bold">
          <AnimatedNumber value={value} />
        </div>
        <ProgressBar value={value / max} color={color} height={4} className="mt-1" />
      </div>
    </div>
  );
}

/** The game HUD: avatar, level, XP bar, HP, Energy, streak, coins. */
export function GameHud() {
  const navigate = useNavigate();
  const player = useGame((s) => s.player);
  const settings = useGame((s) => s.settings);
  const { level, into, needed, progress } = useLevel();
  const [menu, setMenu] = useState(false);
  if (!player || !settings) return <div className="h-[120px] pt-safe" />;
  const cls = classById(computeClassAffinities({ stats: player.stats, categoryCounts: {}, coreRate: 0, streak: player.streak.current, recoveryDays: 0, worldSpend: player.lifetime.coinsSpent })[0].classId);

  return (
    <div className="px-safe pt-[calc(var(--safe-top)+10px)]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setMenu(true)} aria-label="Open profile menu" className="relative">
          <Avatar config={player.avatar} size={48} ring={player.recoveryMode ? 'var(--lf-hp)' : 'var(--lf-accent)'} />
        </button>
        <div className="min-w-0 flex-1" id="hud-xp">
          <div className="flex items-baseline gap-2">
            <span className="num text-[13px] font-extrabold tracking-wider text-muted">LEVEL</span>
            <AnimatedNumber value={level} className="text-[22px] leading-none font-extrabold" />
            <span className="truncate text-[12px] font-semibold text-muted">
              {cls.icon} {cls.name}
            </span>
          </div>
          <ProgressBar value={progress} color="linear-gradient(90deg, var(--lf-xp), #b18cff)" height={8} className="mt-1.5" label="XP to next level" />
          <div className="num mt-0.5 text-[11px] font-semibold text-muted">
            {formatInt(into)} / {formatInt(needed)} XP · {Math.round(progress * 100)}%
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => navigate('/coach')} aria-label="Coach" className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Icon name="chat" size={20} />
          </button>
          <button type="button" onClick={() => navigate('/search')} aria-label="Search" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
            <Icon name="search" size={19} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Meter icon="❤️" value={player.hp} max={100} color="var(--lf-hp)" label="HP" />
        <Meter icon="⚡" value={player.energy} max={player.maxEnergy} color="var(--lf-energy)" label="Energy" />
        <div className="flex items-center gap-1 rounded-2xl bg-surface-2 px-2.5" aria-label={`Streak ${player.streak.current} days`}>
          <Flame size={16} dim={player.streak.current === 0} />
          <span className="num text-[15px] font-bold">{player.streak.current}</span>
        </div>
        <button type="button" id="hud-coins" onClick={() => navigate('/world/shop')} className="hit-44 flex items-center gap-1 rounded-2xl bg-surface-2 px-2.5" aria-label={`${player.coins} coins, open shop`}>
          <span aria-hidden>🪙</span>
          <AnimatedNumber value={player.coins} className="text-[15px] font-bold text-coin" />
        </button>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={settings.profile.nickname || settings.profile.name}>
        <div className="flex items-center gap-4 rounded-3xl bg-surface p-4 shadow-card">
          <Avatar config={player.avatar} size={64} />
          <div>
            <div className="text-[18px] font-bold">Level {level}</div>
            <div className="text-[14px] text-muted">
              {cls.icon} {cls.name} · {formatInt(player.lifetime.xpEarned)} XP lifetime
            </div>
          </div>
        </div>
        <List>
          <Row icon="🧙" title="Character" subtitle="Class, stats, inventory" onClick={() => { setMenu(false); navigate('/profile'); }} />
          <Row icon="🏅" title="Achievements" onClick={() => { setMenu(false); navigate('/achievements'); }} />
          <Row icon="🎨" title="Customize avatar" onClick={() => { setMenu(false); navigate('/world/avatar'); }} />
          <Row icon="🎮" title="Play time" subtitle="Daily budget timer" onClick={() => { setMenu(false); navigate('/play'); }} />
          <Row icon="🔍" title="Search" onClick={() => { setMenu(false); navigate('/search'); }} />
        </List>
        <List>
          <Row icon="⚙️" title="Settings" onClick={() => { setMenu(false); navigate('/settings'); }} />
          <Row icon="🛠️" title="Admin" subtitle="Activities, rules, economy" onClick={() => { setMenu(false); navigate('/admin'); }} />
          {(settings.devMode || import.meta.env.DEV) && <Row icon="🧪" title="Developer toolbox" onClick={() => { setMenu(false); navigate('/dev'); }} />}
        </List>
      </Sheet>
    </div>
  );
}
