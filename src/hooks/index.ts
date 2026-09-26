import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '@/store/gameStore';
import { clock } from '@/services/clock';
import { levelFromXp } from '@/domain/level';

/** Re-render every `intervalMs` with the (possibly time-travelled) game clock. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}

/** Load data from repositories/services; refetches when deps or the store version change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { live?: boolean } = { live: true }): AsyncState<T> {
  const version = useGame((s) => (opts.live === false ? 0 : s.version));
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: Error }>({ loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error: unknown) => alive && setState({ loading: false, error: error instanceof Error ? error : new Error(String(error)) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, loading: state.loading, error: state.error, reload };
}

export function useLevel() {
  const xp = useGame((s) => s.player?.xp ?? 0);
  const rules = useGame((s) => s.settings?.rules.level);
  return rules ? levelFromXp(xp, rules) : { level: 1, into: 0, needed: 1, progress: 0 };
}

export function usePetName(): string {
  return useGame((s) => s.settings?.profile.petName ?? 'Sky');
}

/** Resolve a system theme preference into the `dark` class and accent attribute. */
export function useThemeSync() {
  const theme = useGame((s) => s.settings?.theme ?? 'system');
  const accent = useGame((s) => s.settings?.accent ?? 'ember');
  const reduced = useGame((s) => s.settings?.reducedMotion ?? 'system');
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
    };
    apply();
    try {
      localStorage.setItem('lf-theme', theme);
    } catch {
      // storage may be unavailable
    }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try {
      localStorage.setItem('lf-accent', accent);
    } catch {
      // ignore
    }
  }, [accent]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced === 'on');
  }, [reduced]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Track the last pointer position so reward particles start where the user tapped. */
export const lastPointer = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }, { passive: true, capture: true });
}

/**
 * iOS keyboard awareness. The on-screen keyboard shrinks the *visual* viewport only, so
 * fixed footers end up hidden behind it. We publish the covered height as `--kb` and
 * toggle `html.kb-open`, letting the tab bar hide and composers/footers lift above it.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const open = covered > 80;
      root.style.setProperty('--kb', `${open ? covered : 0}px`);
      // Full-screen views (the Coach chat) size themselves to the visible area.
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvtop', `${Math.round(vv.offsetTop)}px`);
      root.classList.toggle('kb-open', open);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}

type SpeechResultEvent = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onaudiostart?: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

/**
 * iOS Home Screen apps: WebKit's speech recognition there can hang without ever firing
 * `end` or `error` and freeze the page, so it is treated as unavailable and the
 * keyboard's 🎙️ dictation key is used instead (reliable everywhere on iPhone).
 */
export function isIosStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !!standalone;
}

/** Set after a recognizer failed in a way that will repeat (permission, service): stop offering it. */
let speechBroken = false;

function speechCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === 'undefined' || speechBroken || isIosStandalone()) return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Only one recognizer in the whole app at a time (Ask sheet, Coach and field mics share the microphone). */
let activeRec: SpeechRecognitionLike | null = null;
const kill = (r: SpeechRecognitionLike | null) => {
  if (!r) return;
  r.onresult = r.onend = r.onerror = null;
  try {
    if (r.abort) r.abort();
    else r.stop();
  } catch {
    // already stopped
  }
  if (activeRec === r) activeRec = null;
};

const START_TIMEOUT_MS = 6000; // no audio by then → give up instead of hanging
const MAX_SESSION_MS = 20000;
const SILENCE_MS = 3500;

/**
 * Voice input via the Web Speech API where the browser offers it. It only starts from
 * a tap, never runs longer than 20 s, gives up if the microphone never starts, and stops
 * after a short silence, so it can never leave the app stuck in "listening". Where it isn't
 * available (e.g. iOS Home Screen apps) `supported` is false and the keyboard's dictation
 * key is the fallback.
 */
export function useSpeech(lang: string, onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const silence = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);
  const Ctor = speechCtor();

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearTimeout(silence.current);
  };
  const finish = (message?: string) => {
    clearTimers();
    kill(rec.current);
    rec.current = null;
    setListening(false);
    if (message) setError(message);
  };

  const start = () => {
    if (!Ctor) return;
    setError(null);
    clearTimers();
    kill(activeRec);
    let r: SpeechRecognitionLike;
    try {
      r = new Ctor();
    } catch {
      speechBroken = true;
      setError('Voice input isn’t available here. Use the 🎙️ key on the keyboard.');
      return;
    }
    r.lang = lang || navigator.language || 'it-IT';
    r.interimResults = true;
    r.continuous = false;
    let heard = false;
    const alive = () => {
      heard = true;
    };
    r.onstart = alive;
    r.onaudiostart = alive;
    r.onresult = (e) => {
      heard = true;
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = e.results[i].isFinal;
      }
      cb.current(text, final);
      clearTimeout(silence.current);
      if (final) finish();
      else silence.current = setTimeout(() => finish(), SILENCE_MS);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        speechBroken = true;
        finish('Microphone or speech recognition not allowed. Use the 🎙️ key on the keyboard.');
      } else if (e.error === 'no-speech' || e.error === 'aborted') finish();
      else finish('Voice input stopped. You can type or use the 🎙️ key on the keyboard.');
    };
    r.onend = () => finish();
    rec.current = r;
    activeRec = r;
    try {
      r.start();
      setListening(true);
      timers.current.push(
        setTimeout(() => {
          if (!heard) finish('The microphone didn’t start. Use the 🎙️ key on the keyboard.');
        }, START_TIMEOUT_MS),
        setTimeout(() => finish(), MAX_SESSION_MS),
      );
    } catch {
      finish('Voice input isn’t available right now.');
    }
  };
  const stop = () => finish();
  useEffect(
    () => () => {
      clearTimers();
      kill(rec.current);
    },
    [],
  );
  return { supported: !!Ctor, listening, error, start, stop };
}
