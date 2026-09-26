import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { create } from 'zustand';
import { useSpeech } from '@/hooks';
import { useGame } from '@/store/gameStore';
import { Icon } from '../ui/Icon';
import { Button, cx } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';

const useAsk = create<{ open: boolean; listen: boolean; set: (open: boolean, listen?: boolean) => void }>((set) => ({
  open: false,
  listen: false,
  set: (open, listen = false) => set({ open, listen }),
}));

/** Open "Ask LifeForge" (call it from a tap so the microphone may start right away). */
export function openAsk(listen = true): void {
  useAsk.getState().set(true, listen);
}

const EXAMPLES = ['Domani alle 18 palestra', 'Porta le proteine a 150 g', 'Plan my day', 'No gym this week'];

/**
 * Global voice entry point. What you say becomes a message for the Coach;
 * anything that changes the game still shows a preview there and needs APPLY.
 */
export function AskSheet() {
  const { open, listen, set } = useAsk();
  const navigate = useNavigate();
  const settings = useGame((s) => s.settings);
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech(settings?.coach.voiceLang ?? '', (t) => setText(t));

  // The microphone only starts from a tap on the big button (iOS blocks or hangs speech
  // recognition started outside a gesture). Without Web Speech the text field is focused
  // so the keyboard's 🎙️ dictation key is one tap away.
  useEffect(() => {
    if (!open) {
      speech.stop();
      return;
    }
    setText('');
    if (listen && !speech.supported) setTimeout(() => input.current?.focus(), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listen]);

  const close = () => set(false);
  const send = (t = text) => {
    if (!t.trim()) return;
    close();
    navigate('/coach', { state: { draft: t.trim(), send: true } });
  };

  return (
    <Sheet open={open} onClose={close} title="Ask LifeForge">
      <div className="flex flex-col items-center pb-2">
        <button
          type="button"
          onClick={() => (!speech.supported ? input.current?.focus() : speech.listening ? speech.stop() : speech.start())}
          aria-label={speech.listening ? 'Stop listening' : 'Start listening'}
          className={cx('relative mt-2 flex h-24 w-24 items-center justify-center rounded-full', speech.listening ? 'bg-danger text-white' : 'bg-accent text-on-accent', !speech.supported && 'opacity-40')}
        >
          {speech.listening && <motion.span className="absolute inset-0 rounded-full bg-danger/40" animate={{ scale: [1, 1.35], opacity: [0.6, 0] }} transition={{ repeat: Infinity, duration: 1.2 }} />}
          <Icon name="mic" size={40} />
        </button>
        <div className="mt-3 text-[13px] font-extrabold tracking-[0.18em] text-muted" aria-live="polite">
          {speech.listening ? 'LISTENING… TAP TO STOP' : speech.supported ? 'TAP TO SPEAK' : 'TYPE OR DICTATE'}
        </div>
        {!speech.supported && <p className="mt-1 text-center text-[12px] text-muted">Tap the field, then the 🎙️ key on the iPhone keyboard to dictate.</p>}
        {speech.error && <p className="mt-1 text-center text-[12px] text-danger">{speech.error}</p>}
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="e.g. “Tomorrow at 18 gym”"
          aria-label="Your request"
          className="mt-3 w-full resize-none rounded-3xl border border-line bg-surface px-4 py-3 text-[16px] outline-none focus:border-accent"
        />
        <div className="mt-2 flex w-full flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className="min-h-11 rounded-full bg-surface-2 px-3 text-[13px] font-semibold">
              {e}
            </button>
          ))}
        </div>
        <Button block size="lg" icon="send" className="mt-3" disabled={!text.trim()} onClick={() => send()}>
          Send to Coach
        </Button>
        <p className="mt-2 text-center text-[12px] text-muted">Changes are always shown as a preview first — nothing is applied without your OK.</p>
        <button type="button" onClick={() => { close(); navigate('/coach'); }} className="mt-1 min-h-11 text-[14px] font-semibold text-accent">
          Open Coach chat
        </button>
      </div>
    </Sheet>
  );
}
