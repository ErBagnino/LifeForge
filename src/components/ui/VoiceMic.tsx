import { motion } from 'motion/react';
import { useState } from 'react';
import { useSpeech } from '@/hooks';
import { useGame } from '@/store/gameStore';
import { Icon } from './Icon';
import { cx } from './primitives';

/**
 * Microphone button that dictates into a text field (Web Speech API).
 * Where the browser has no speech recognition it explains the keyboard-mic fallback.
 * Dictated text is only placed in the field: nothing is sent or applied automatically.
 */
export function VoiceMic({ onText, className, size = 36 }: { onText: (text: string, final: boolean) => void; className?: string; size?: number }) {
  const settings = useGame((s) => s.settings);
  const speech = useSpeech(settings?.coach.voiceLang ?? '', onText);
  const [hint, setHint] = useState(false);
  if (settings && !settings.coach.voice) return null;
  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      <button
        type="button"
        aria-label={speech.listening ? 'Stop voice input' : 'Voice input'}
        aria-pressed={speech.listening}
        onClick={() => {
          if (!speech.supported) return setHint((h) => !h);
          if (speech.listening) speech.stop();
          else speech.start();
        }}
        className={cx('hit-44 flex items-center justify-center rounded-full', speech.listening ? 'bg-danger text-white' : 'text-muted')}
        style={{ width: size, height: size }}
      >
        {speech.listening ? (
          <motion.span animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
            <Icon name="mic" size={18} />
          </motion.span>
        ) : (
          <Icon name="mic" size={18} />
        )}
      </button>
      {(hint || speech.error) && (
        <span role="status" className="absolute top-full right-0 z-30 mt-1 w-56 rounded-2xl bg-fg px-3 py-2 text-[12px] leading-snug text-bg shadow-lg" onClick={() => setHint(false)}>
          {speech.error ?? 'Voice input isn’t available in this browser. Tip: use the 🎙️ key on the iPhone keyboard.'}
        </span>
      )}
    </span>
  );
}
