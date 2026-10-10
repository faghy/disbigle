import type { Notification } from '@disbigle/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import {
  type NotificationPages,
  removeStatusEverywhere,
  socialKeys,
  storeStatus,
} from '../api/cache.ts';
import { useCurrentUser } from '../api/queries.ts';
import { StreamingClient, type StreamListener } from '../lib/streaming.ts';

const StreamingContext = createContext<StreamingClient | null>(null);

/** Adds a pushed notification to the cached list and bumps the unread badge. */
function addNotification(
  queryClient: ReturnType<typeof useQueryClient>,
  notification: Notification,
) {
  queryClient.setQueryData<number>(socialKeys.unreadCount, (count) => (count ?? 0) + 1);
  queryClient.setQueryData<NotificationPages>(socialKeys.notifications, (data) => {
    if (!data) return data;
    if (data.pages.some((page) => page.some((n) => n.id === notification.id))) return data;
    const [first = [], ...rest] = data.pages;
    return { ...data, pages: [[notification, ...first], ...rest] };
  });
}

/**
 * Owns the app's WebSocket. The connection is re-created when the signed-in user changes,
 * because the server authenticates it with the session cookie when it opens.
 */
export function StreamingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const userId = user?.account.id ?? null;
  const [client, setClient] = useState<StreamingClient | null>(null);

  useEffect(() => {
    const next = new StreamingClient();
    setClient(next);
    const offAny = next.onAny((event) => {
      if (event.event === 'delete') removeStatusEverywhere(queryClient, event.payload);
      else if (event.event === 'status.update') storeStatus(queryClient, event.payload);
      else if (event.event === 'notification') addNotification(queryClient, event.payload);
    });
    const offReconnect = next.onReconnect(() => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.unreadCount });
    });
    // Signed-in users always listen to their own stream for notifications.
    const offUser = userId ? next.subscribe('user', () => {}) : null;
    return () => {
      offAny();
      offReconnect();
      offUser?.();
      next.close();
    };
  }, [queryClient, userId]);

  return <StreamingContext.Provider value={client}>{children}</StreamingContext.Provider>;
}

/** Calls `handler` for each event on `stream` while the component is mounted. */
export function useStream(stream: string | null, handler: StreamListener) {
  const client = useContext(StreamingContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!client || !stream) return;
    return client.subscribe(stream, (event) => handlerRef.current(event));
  }, [client, stream]);
}
