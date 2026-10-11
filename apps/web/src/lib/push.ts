import { api } from '../api/client.ts';

export const pushAlertTypes = [
  'mention',
  'reply',
  'follow',
  'follow_request',
  'reblog',
  'like',
  'poll',
] as const;
export type PushAlertType = (typeof pushAlertTypes)[number];
export type PushAlerts = Record<PushAlertType, boolean>;

export const defaultPushAlerts: PushAlerts = {
  mention: true,
  reply: true,
  follow: true,
  follow_request: true,
  reblog: true,
  like: true,
  poll: true,
};

export const SERVICE_WORKER_URL = '/sw.js';
const ALERTS_KEY = 'disbigle.pushAlerts';

/** Decodes a base64url string (as VAPID keys are published) to the bytes the browser expects. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PushSupport = 'supported' | 'unsupported' | 'ios-install';

interface Environment {
  navigator: Navigator & { standalone?: boolean };
  window: Window;
}

/**
 * Whether this browser can receive Web Push. On iPhone and iPad, push only works once the
 * site has been added to the Home Screen and opened from there.
 */
export function detectPushSupport(
  env: Environment = { navigator: globalThis.navigator, window: globalThis.window },
): PushSupport {
  const { navigator, window } = env;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const capable =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (capable) return 'supported';
  if (ios && !standalone) return 'ios-install';
  return 'unsupported';
}

/** Registers the service worker once; later calls reuse the existing registration. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ?? navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
}

/** Alert choices are also kept locally, as a fallback when the server cannot be asked. */
export function loadAlerts(endpoint: string): PushAlerts {
  try {
    const saved = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? 'null') as {
      endpoint?: string;
      alerts?: Partial<PushAlerts>;
    } | null;
    if (saved?.endpoint === endpoint) return { ...defaultPushAlerts, ...saved.alerts };
  } catch {
    // Unreadable storage: fall back to the defaults.
  }
  return { ...defaultPushAlerts };
}

export function saveAlerts(endpoint: string, alerts: PushAlerts) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify({ endpoint, alerts }));
  } catch {
    // Not fatal: the server still has the choices.
  }
}

export function forgetAlerts() {
  try {
    localStorage.removeItem(ALERTS_KEY);
  } catch {
    // Ignore.
  }
}

/** The parts of a PushSubscription the server needs. */
export function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

export const pushApi = {
  key: () => api.get<{ publicKey: string }>('/push/key'),
  /** What the server has saved for this device, or `null` if it does not know it. */
  get: (endpoint: string) =>
    api.get<{ endpoint: string; alerts: Partial<PushAlerts> } | null>(
      `/push/subscription?endpoint=${encodeURIComponent(endpoint)}`,
    ),
  save: (subscription: PushSubscription, alerts: PushAlerts) =>
    api.post<{ endpoint: string; alerts: PushAlerts }>('/push/subscription', {
      subscription: subscriptionBody(subscription),
      alerts,
    }),
  remove: (endpoint: string) =>
    api.delete<{ status: 'ok' }>(`/push/subscription?endpoint=${encodeURIComponent(endpoint)}`),
};
