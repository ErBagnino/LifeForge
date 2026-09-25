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
  start(): void;
  stop(): void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * Voice input via the Web Speech API where the browser offers it. Elsewhere
 * (e.g. some iOS home-screen modes) `supported` is false and the keyboard's
 * dictation key is the fallback.
 */
export function useSpeech(lang: string, onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);
  const Ctor = speechCtor();
  const start = () => {
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = lang || navigator.language || 'it-IT';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = e.results[i].isFinal;
      }
      cb.current(text, final);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice input stopped.');
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };
  const stop = () => {
    rec.current?.stop();
    setListening(false);
  };
  useEffect(() => () => rec.current?.stop(), []);
  return { supported: !!Ctor, listening, error, start, stop };
}
