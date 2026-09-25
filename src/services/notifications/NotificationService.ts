import type { NotificationType } from '@/types';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/** One delivery channel. The app never talks to the browser Notification API directly. */
export interface NotificationProvider {
  readonly id: 'inapp' | 'browser' | 'webpush' | 'native';
  isSupported(): boolean;
  permission(): PermissionState;
  requestPermission(): Promise<PermissionState>;
  show(payload: NotificationPayload): Promise<boolean>;
}

type InAppListener = (payload: NotificationPayload) => void;

export class InAppProvider implements NotificationProvider {
  readonly id = 'inapp' as const;
  private listeners = new Set<InAppListener>();
  isSupported() {
    return true;
  }
  permission(): PermissionState {
    return 'granted';
  }
  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
  subscribe(l: InAppListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  async show(payload: NotificationPayload) {
    this.listeners.forEach((l) => l(payload));
    return this.listeners.size > 0;
  }
}

export class BrowserProvider implements NotificationProvider {
  readonly id = 'browser' as const;
  isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }
  permission(): PermissionState {
    return this.isSupported() ? (Notification.permission as PermissionState) : 'unsupported';
  }
  async requestPermission(): Promise<PermissionState> {
    if (!this.isSupported()) return 'unsupported';
    try {
      return (await Notification.requestPermission()) as PermissionState;
    } catch {
      return 'denied';
    }
  }
  async show(payload: NotificationPayload) {
    if (this.permission() !== 'granted') return false;
    const options: NotificationOptions = { body: payload.body, tag: payload.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: payload.url ?? '/' } };
    try {
      // iOS home-screen apps only support notifications through the service worker.
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (reg) {
        await reg.showNotification(payload.title, options);
        return true;
      }
      new Notification(payload.title, options);
      return true;
    } catch {
      return false;
    }
  }
}

export interface PushConfig {
  publicKey?: string;
  endpoint?: string;
}

export interface ScheduledPush {
  at: number;
  title: string;
  body: string;
  tag: string;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Web Push: only active when VITE_PUSH_PUBLIC_KEY and VITE_PUSH_ENDPOINT are configured.
 * The backend receives only the subscription and the notification text/time — no game data.
 */
export class WebPushProvider implements NotificationProvider {
  readonly id = 'webpush' as const;
  constructor(private config: PushConfig) {}
  get configured(): boolean {
    return !!this.config.publicKey && !!this.config.endpoint;
  }
  isSupported() {
    return this.configured && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  }
  permission(): PermissionState {
    return this.isSupported() && 'Notification' in window ? (Notification.permission as PermissionState) : 'unsupported';
  }
  async requestPermission(): Promise<PermissionState> {
    if (!this.isSupported()) return 'unsupported';
    return (await Notification.requestPermission()) as PermissionState;
  }
  async subscription(): Promise<PushSubscription | null> {
    if (!this.isSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async subscribe(): Promise<boolean> {
    if (!this.isSupported() || this.permission() !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(this.config.publicKey!) }));
      const res = await fetch(`${this.config.endpoint}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  async unsubscribe(): Promise<void> {
    const sub = await this.subscription();
    if (!sub) return;
    try {
      await fetch(`${this.config.endpoint}/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    } finally {
      await sub.unsubscribe();
    }
  }
  /** Replace the server-side schedule for the next 24 h (minimal data only). */
  async sync(reminders: ScheduledPush[]): Promise<boolean> {
    const sub = await this.subscription();
    if (!sub) return false;
    try {
      const res = await fetch(`${this.config.endpoint}/schedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, reminders }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  async show(): Promise<boolean> {
    // Delivery happens server-side through `sync`.
    return false;
  }
}

export interface NotificationStatus {
  browserSupported: boolean;
  permission: PermissionState;
  standalone: boolean;
  isIos: boolean;
  pushConfigured: boolean;
  pushSupported: boolean;
}

export class NotificationService {
  readonly inApp = new InAppProvider();
  readonly browser = new BrowserProvider();
  readonly push: WebPushProvider;

  constructor(pushConfig: PushConfig) {
    this.push = new WebPushProvider(pushConfig);
  }

  status(): NotificationStatus {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const isIos = !!nav && /iphone|ipad|ipod/i.test(nav.userAgent);
    const standalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches || (nav as Navigator & { standalone?: boolean })?.standalone === true);
    return {
      browserSupported: this.browser.isSupported(),
      permission: this.browser.permission(),
      standalone: !!standalone,
      isIos,
      pushConfigured: this.push.configured,
      pushSupported: this.push.isSupported(),
    };
  }

  async requestPermission(): Promise<PermissionState> {
    const p = await this.browser.requestPermission();
    if (p === 'granted' && this.push.isSupported()) await this.push.subscribe();
    return p;
  }

  /**
   * Deliver a notification: in-app while the app is visible, system notification
   * otherwise (when permitted). Returns the channel used.
   */
  async notify(payload: NotificationPayload): Promise<'inapp' | 'browser' | 'none'> {
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    if (visible && (await this.inApp.show(payload))) return 'inapp';
    if (await this.browser.show(payload)) return 'browser';
    if (await this.inApp.show(payload)) return 'inapp';
    return 'none';
  }
}

export const notificationService = new NotificationService({
  publicKey: import.meta.env.VITE_PUSH_PUBLIC_KEY as string | undefined,
  endpoint: import.meta.env.VITE_PUSH_ENDPOINT as string | undefined,
});
