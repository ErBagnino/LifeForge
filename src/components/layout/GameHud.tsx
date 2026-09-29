import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MAX_LEVEL } from '@/domain/level';
import { classById, computeClassAffinities } from '@/domain/classes';
import { useLevel } from '@/hooks';
import { useGame } from '@/store/gameStore';
import { formatCompact, formatInt } from '@/utils/format';
import { Avatar } from '../game/Avatar';
import { Flame } from '../game/bits';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/primitives';
import { AnimatedNumber, ProgressBar } from '../ui/progress';
import { Sheet } from '../ui/Sheet';
import { Row, List } from '../ui/forms';
import { InfoTip, type InfoKey } from '../ui/InfoTip';
import { openAsk } from './AskSheet';

/** A slim resource bar: icon, value and a thin track. Quiet on purpose — level and XP lead the HUD. */
function Meter({ icon, value, max, color, label, id, tip, alert }: { icon: string; value: number; max: number; color: string; label: string; id?: string; tip?: InfoKey; alert?: boolean }) {
  return (
    <div id={id} data-tour={tip} className="flex min-w-0 flex-1 items-center gap-1.5" aria-label={`${label} ${Math.round(value)} of ${max}`}>
      <span aria-hidden className={cx('text-[12px]', alert && 'lf-pulse')}>
        {icon}
      </span>
      <ProgressBar value={value / max} color={color} height={5} className="min-w-0 flex-1" />
      <span className="num w-7 shrink-0 text-right text-[12px] leading-none font-bold text-muted">
        <AnimatedNumber value={value} />
      </span>
      {tip && <InfoTip k={tip} className="max-[359px]:hidden" />}
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
  if (!player || !settings) return <div className="h-[100px] pt-safe" />;
  const cls = classById(computeClassAffinities({ stats: player.stats, categoryCounts: {}, coreRate: 0, streak: player.streak.current, recoveryDays: 0, worldSpend: player.lifetime.coinsSpent })[0].classId);

  return (
    <div className="px-safe pt-[calc(var(--safe-top)+8px)]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setMenu(true)} aria-label={`Open profile menu, level ${level}`} data-tour="profile" className="relative shrink-0">
          <Avatar config={player.avatar} size={46} ring={player.recoveryMode ? 'var(--lf-hp)' : 'var(--lf-accent)'} />
          <span className="num absolute -right-1 -bottom-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-bg bg-accent px-1 text-[11px] leading-none font-black text-on-accent" aria-hidden>
            {level}
          </span>
        </button>
        <div className="min-w-0 flex-1" id="hud-xp">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-bold">
              Level {level} <span className="font-semibold text-muted">· {cls.icon} {cls.name}</span>
            </span>
            <span className="num shrink-0 text-[11px] font-semibold text-muted">{level >= MAX_LEVEL ? 'MAX' : `${formatCompact(into)}/${formatCompact(needed)}`}</span>
          </div>
          <ProgressBar value={progress} color="linear-gradient(90deg, var(--lf-xp), #b18cff)" height={7} className="mt-1" label={level >= MAX_LEVEL ? 'Max level reached' : `XP to level ${level + 1}: ${Math.round(progress * 100)}%`} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => openAsk()} aria-label="Ask LifeForge" data-tour="ask" className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Icon name="mic" size={20} />
          </button>
          <button type="button" onClick={() => navigate('/stats')} aria-label="Stats" data-tour="stats" className="flex h-11 w-9 items-center justify-center rounded-full text-muted">
            <Icon name="stats" size={19} />
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <Meter icon="❤️" value={player.hp} max={100} color="var(--lf-hp)" label="HP" tip="hp" alert={player.hp <= 30} />
        <Meter id="hud-energy" icon="⚡" value={player.energy} max={player.maxEnergy} color="var(--lf-energy)" label="Energy" tip="energy" />
        <button type="button" id="hud-coins" onClick={() => navigate('/world/shop')} className="hit-44 flex shrink-0 items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1" aria-label={`Streak ${player.streak.current} days. ${formatInt(player.coins)} coins, open shop`}>
          <span className="flex items-center gap-0.5">
            <Flame size={13} dim={player.streak.current === 0} hot={player.streak.current >= 7} />
            <span className="num text-[13px] font-bold">{player.streak.current}</span>
          </span>
          <span className="flex items-center gap-0.5">
            <span aria-hidden className="text-[12px]">
              🪙
            </span>
            <AnimatedNumber value={player.coins} format={formatCompact} className="text-[13px] font-bold text-coin" />
          </span>
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
          <Row icon="🌿" title="Mastery" subtitle="Ten life tracks and perk titles" onClick={() => { setMenu(false); navigate('/mastery'); }} />
          <Row icon="🧭" title="Journey" subtitle="Chapters and milestones" onClick={() => { setMenu(false); navigate('/journey'); }} />
          <Row icon="🎨" title="Customize avatar" onClick={() => { setMenu(false); navigate('/world/avatar'); }} />
          <Row icon="🎮" title="Play time" subtitle="Daily budget timer" onClick={() => { setMenu(false); navigate('/play'); }} />
          <Row icon="💬" title="Coach chat" subtitle="Gemini AI or basic coach" onClick={() => { setMenu(false); navigate('/coach'); }} />
          <Row icon="📊" title="Stats" onClick={() => { setMenu(false); navigate('/stats'); }} />
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
