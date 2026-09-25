import { useEffect, useState } from 'react';

/**
 * Service worker registration with an explicit "update available" prompt,
 * so a new version never reloads the app in the middle of a workout.
 */
export function usePwaUpdate(): { needRefresh: boolean; update: () => void } {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updater, setUpdater] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          setNeedRefresh(true);
        },
        onRegisteredSW(_url, reg) {
          if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
        },
      });
      setUpdater(() => () => update(true));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { needRefresh, update: () => void updater?.() };
}
