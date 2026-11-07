import type { PresenceState } from '@disbigle/shared';
import { useEffect } from 'react';
import { useCurrentUser } from '../api/queries.ts';
import { social } from '../api/social.ts';

/** How often the app says it is open; the server forgets it after 90 seconds. */
const HEARTBEAT_MS = 45_000;
/** No key, click or scroll for this long: away. */
const IDLE_MS = 5 * 60_000;

/**
 * While you share your status (Messages → "Your status"), tells the server every 45 seconds
 * whether you are using the app: visible and touched in the last 5 minutes is "online",
 * otherwise "away". Nothing is sent while it is hidden.
 */
export function usePresenceHeartbeat() {
  const user = useCurrentUser();
  const sharing = Boolean(user && user.presence !== 'hidden');
  useEffect(() => {
    if (!sharing) return;
    let lastActivity = Date.now();
    let lastSent: boolean | null = null;
    const active = () =>
      document.visibilityState === 'visible' && Date.now() - lastActivity < IDLE_MS;
    const send = (force = false) => {
      const now = active();
      if (!force && now === lastSent) return;
      lastSent = now;
      void social.presence(now).catch(() => {});
    };
    const onActivity = () => {
      const wasActive = active();
      lastActivity = Date.now();
      if (!wasActive) send();
    };
    const onVisibility = () => send();
    send(true);
    const timer = setInterval(() => send(true), HEARTBEAT_MS);
    for (const event of ['keydown', 'pointerdown', 'scroll'] as const)
      window.addEventListener(event, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      for (const event of ['keydown', 'pointerdown', 'scroll'] as const)
        window.removeEventListener(event, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sharing]);
}

export const presenceColor: Record<PresenceState, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-400',
  busy: 'bg-red-500',
};
