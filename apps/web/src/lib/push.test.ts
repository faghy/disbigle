import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultPushAlerts,
  detectPushSupport,
  loadAlerts,
  saveAlerts,
  urlBase64ToUint8Array,
} from './push.ts';

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQIDBA')]).toEqual([1, 2, 3, 4]);
    // '-' and '_' stand for '+' and '/'.
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });

  it('turns a 65-byte VAPID key into 65 bytes starting with 0x04', () => {
    const raw = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
    const base64url = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const bytes = urlBase64ToUint8Array(base64url);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect([...bytes]).toEqual([...raw]);
  });
});

describe('detectPushSupport', () => {
  const env = (opts: {
    userAgent: string;
    capable: boolean;
    standalone?: boolean;
    desktop?: boolean;
  }) => {
    const navigator = {
      userAgent: opts.userAgent,
      platform: opts.desktop ? 'Linux' : 'iPhone',
      maxTouchPoints: opts.desktop ? 0 : 5,
      standalone: opts.standalone ?? false,
      ...(opts.capable ? { serviceWorker: {} } : {}),
    } as unknown as Navigator;
    const window = {
      matchMedia: () => ({ matches: opts.standalone ?? false }),
      ...(opts.capable ? { PushManager: {}, Notification: {} } : {}),
    } as unknown as Window;
    return { navigator, window };
  };
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';

  it('reports browsers that can subscribe', () => {
    expect(detectPushSupport(env({ userAgent: 'Firefox', capable: true }))).toBe('supported');
  });

  it('asks iPhone users in a Safari tab to add the app to the Home Screen', () => {
    expect(detectPushSupport(env({ userAgent: iphone, capable: false }))).toBe('ios-install');
  });

  it('reports other browsers without push as unsupported', () => {
    expect(detectPushSupport(env({ userAgent: 'OldBrowser', capable: false, desktop: true }))).toBe(
      'unsupported',
    );
  });
});

describe('alert preferences', () => {
  afterEach(() => localStorage.clear());

  it('are remembered for the same subscription only', () => {
    saveAlerts('https://push.example/1', { ...defaultPushAlerts, like: false });
    expect(loadAlerts('https://push.example/1').like).toBe(false);
    expect(loadAlerts('https://push.example/2')).toEqual(defaultPushAlerts);
  });
});
