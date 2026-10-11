import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlBase64ToUint8Array } from '../../lib/push.ts';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const VAPID_KEY =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const ENDPOINT = 'https://push.example/send/abc';

function fakeSubscription() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** A browser with service workers and push, where the user answers `permission`. */
function installPush({
  permission = 'default' as NotificationPermission,
  answer = 'granted' as NotificationPermission,
  subscribed = false,
} = {}) {
  let current: ReturnType<typeof fakeSubscription> | null = subscribed ? fakeSubscription() : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (_options: PushSubscriptionOptionsInit) => {
      current = fakeSubscription();
      return current;
    }),
  };
  const registration = { pushManager };
  let registered = subscribed;
  const serviceWorker = {
    getRegistration: vi.fn(async () => (registered ? registration : undefined)),
    register: vi.fn(async () => {
      registered = true;
      return registration;
    }),
    ready: Promise.resolve(registration),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn(async () => answer),
  });
  return { pushManager, serviceWorker, current: () => current };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  localStorage.clear();
});

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => (init?.method ?? 'GET') === method && String(url).startsWith(path),
  );

describe('notification settings', () => {
  it('subscribes this device with the VAPID key and saves the chosen alerts', async () => {
    const push = installPush();
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /push/key': { body: { publicKey: VAPID_KEY } },
      'POST /push/subscription': (body) => ({
        body: {
          endpoint: ENDPOINT,
          alerts: (body as { alerts: Record<string, boolean> }).alerts,
        },
      }),
      'DELETE /push/subscription': { body: { status: 'ok' } },
    });
    renderApp('/settings/notifications');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText('Notifications are on for this device.')).toBeInTheDocument();

    expect(push.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    const options = push.pushManager.subscribe.mock.calls[0]?.[0];
    if (!options) throw new Error('subscribe was not called');
    expect(options.userVisibleOnly).toBe(true);
    expect([...(options.applicationServerKey as Uint8Array)]).toEqual([
      ...urlBase64ToUint8Array(VAPID_KEY),
    ]);
    const [first] = calls(fetchMock, 'POST', '/api/v1/push/subscription');
    expect(JSON.parse(String(first?.[1]?.body))).toEqual({
      subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } },
      alerts: {
        mention: true,
        reply: true,
        follow: true,
        follow_request: true,
        reblog: true,
        like: true,
        poll: true,
      },
    });

    // Turning one type off saves the whole set again.
    await user.click(screen.getByRole('checkbox', { name: 'Likes' }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/push/subscription')).toHaveLength(2),
    );
    const second = calls(fetchMock, 'POST', '/api/v1/push/subscription')[1];
    expect(JSON.parse(String(second?.[1]?.body)).alerts.like).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Likes' })).not.toBeChecked();

    // Turning off removes it on the server and in the browser.
    const subscription = push.current();
    await user.click(screen.getByRole('button', { name: 'Turn off on this device' }));
    expect(
      await screen.findByRole('button', { name: 'Turn on notifications' }),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'DELETE', '/api/v1/push/subscription')[0]?.[0]).toBe(
      `/api/v1/push/subscription?endpoint=${encodeURIComponent(ENDPOINT)}`,
    );
    expect(subscription?.unsubscribe).toHaveBeenCalled();
  });

  it('remembers the alerts of an existing subscription', async () => {
    installPush({ permission: 'granted', subscribed: true });
    localStorage.setItem(
      'disbigle.pushAlerts',
      JSON.stringify({ endpoint: ENDPOINT, alerts: { reblog: false } }),
    );
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'POST /push/subscription': (body) => ({
        body: { endpoint: ENDPOINT, alerts: (body as { alerts: object }).alerts },
      }),
    });
    renderApp('/settings/notifications');
    const fieldset = await screen.findByRole('group', { name: 'Notify me about' });
    expect(
      within(fieldset).getByRole('checkbox', { name: 'Reshares of my posts' }),
    ).not.toBeChecked();
    expect(within(fieldset).getByRole('checkbox', { name: 'Mentions' })).toBeChecked();
    // The subscription is re-sent with the remembered choices (never reset to defaults).
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/push/subscription')).toHaveLength(1),
    );
    const body = JSON.parse(
      String(calls(fetchMock, 'POST', '/api/v1/push/subscription')[0]?.[1]?.body),
    );
    expect(body.alerts.reblog).toBe(false);
  });

  it('explains when the user does not allow notifications', async () => {
    const push = installPush({ answer: 'denied' });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /push/key': { body: { publicKey: VAPID_KEY } },
    });
    renderApp('/settings/notifications');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
    expect(push.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('says when the browser has no push support', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp('/settings/notifications');
    expect(
      await screen.findByText(/This browser cannot receive push notifications/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument();
  });

  it('cleans up the browser subscription if the server refuses it', async () => {
    const push = installPush();
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /push/key': { body: { publicKey: VAPID_KEY } },
      'POST /push/subscription': {
        status: 422,
        body: { error: 'validation_failed', message: 'Push endpoint must use https' },
      },
    });
    renderApp('/settings/notifications');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some fields are invalid');
    expect(push.current()?.unsubscribe).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument();
  });

  it('shows the choices saved on the server for this device', async () => {
    installPush({ permission: 'granted', subscribed: true });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /push/subscription': (_body, url) => ({
        body:
          url.searchParams.get('endpoint') === ENDPOINT
            ? { endpoint: ENDPOINT, alerts: { like: false, poll: false } }
            : null,
      }),
    });
    renderApp('/settings/notifications');
    const fieldset = await screen.findByRole('group', { name: 'Notify me about' });
    await waitFor(() =>
      expect(within(fieldset).getByRole('checkbox', { name: 'Likes' })).not.toBeChecked(),
    );
    expect(within(fieldset).getByRole('checkbox', { name: 'Mentions' })).toBeChecked();
    // Known to the server: nothing is re-sent.
    expect(calls(fetchMock, 'POST', '/api/v1/push/subscription')).toHaveLength(0);
  });
});
