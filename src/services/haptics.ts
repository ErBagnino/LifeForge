type Pattern = 'tap' | 'success' | 'achievement' | 'levelUp' | 'warning';

const VIBRATE: Record<Pattern, number[]> = {
  tap: [8],
  success: [12, 40, 18],
  achievement: [20, 60, 20, 60, 40],
  levelUp: [30, 50, 30, 50, 30, 50, 80],
  warning: [40, 80, 40],
};

const IOS_PULSES: Record<Pattern, number> = { tap: 1, success: 2, achievement: 3, levelUp: 4, warning: 2 };

let enabled = true;
let iosLabel: HTMLLabelElement | null = null;

/**
 * iOS Safari 18+ has no Vibration API, but toggling a native `<input switch>` produces
 * a system haptic. We use it as a graceful enhancement; elsewhere it is a no-op.
 */
function iosTick() {
  if (typeof document === 'undefined') return;
  if (!iosLabel) {
    iosLabel = document.createElement('label');
    iosLabel.setAttribute('aria-hidden', 'true');
    iosLabel.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;left:-10px;top:-10px';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosLabel.appendChild(input);
    document.body.appendChild(iosLabel);
  }
  iosLabel.click();
}

export const haptics = {
  setEnabled(v: boolean) {
    enabled = v;
  },
  play(pattern: Pattern) {
    if (!enabled || typeof navigator === 'undefined') return;
    try {
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(VIBRATE[pattern]);
        return;
      }
      const pulses = IOS_PULSES[pattern];
      for (let i = 0; i < pulses; i++) setTimeout(iosTick, i * 90);
    } catch {
      // Haptics are best-effort.
    }
  },
  tap() {
    this.play('tap');
  },
  success() {
    this.play('success');
  },
  achievement() {
    this.play('achievement');
  },
  levelUp() {
    this.play('levelUp');
  },
  warning() {
    this.play('warning');
  },
};
