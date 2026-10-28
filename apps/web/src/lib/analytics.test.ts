import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliceUser, makeStatus } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';
import { genericPath, trackingRefused } from './analytics.ts';

describe('analytics', () => {
  it('sends route patterns, never names or posts', () => {
    expect(genericPath('/@{$username}/$statusId')).toBe('/@profile/post');
    expect(genericPath('/@{$username}')).toBe('/@profile');
    expect(genericPath('/tags/$tag')).toBe('/tags/tag');
    expect(genericPath('/settings/')).toBe('/settings');
    expect(genericPath('/')).toBe('/');
  });

  it('respects Do Not Track and Global Privacy Control', () => {
    expect(trackingRefused({ doNotTrack: '1' } as Navigator)).toBe(true);
    expect(trackingRefused({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(trackingRefused({ doNotTrack: null } as Navigator)).toBe(false);
  });

  describe('page views', () => {
    const sent: string[] = [];
    const RealImage = globalThis.Image;
    beforeEach(() => {
      sent.length = 0;
      globalThis.Image = class {
        referrerPolicy = '';
        set src(value: string) {
          sent.push(value);
        }
      } as unknown as typeof Image;
    });
    afterEach(() => {
      globalThis.Image = RealImage;
    });

    it('sends one generic page view per screen when the server has Matomo', async () => {
      const status = makeStatus();
      const withMatomo = instance();
      mockApi({
        'GET /me': { body: aliceUser },
        'GET /instance': {
          body: {
            ...withMatomo.body,
            analytics: { matomoUrl: 'https://matomo.test/', siteId: 52 },
          },
        },
        'GET /timelines/home': { body: [status] },
        'GET /aspects': { body: [] },
        'GET /timelines/public': { body: [] },
      });
      renderApp('/');
      await waitFor(() => expect(sent).toHaveLength(1));
      const first = new URL(sent[0] ?? '');
      expect(first.origin + first.pathname).toBe('https://matomo.test/matomo.php');
      expect(first.searchParams.get('idsite')).toBe('52');
      expect(first.searchParams.get('action_name')).toBe('/');

      await userEvent.setup().click(await screen.findByRole('link', { name: /federated/i }));
      await waitFor(() => expect(sent).toHaveLength(2));
      expect(new URL(sent[1] ?? '').searchParams.get('action_name')).toBe('/public');
      expect(sent.join(' ')).not.toContain(status.account.username);
    });

    it('sends nothing without Matomo or when the browser refuses tracking', async () => {
      mockApi({
        'GET /me': { body: aliceUser },
        'GET /instance': instance(),
        'GET /timelines/home': { body: [] },
        'GET /aspects': { body: [] },
      });
      renderApp('/');
      await screen.findByRole('textbox', { name: 'New post' });
      expect(sent).toEqual([]);

      vi.stubGlobal('navigator', { ...navigator, doNotTrack: '1' });
      mockApi({
        'GET /me': { body: aliceUser },
        'GET /instance': {
          body: { ...instance().body, analytics: { matomoUrl: 'https://m.test', siteId: 1 } },
        },
        'GET /timelines/home': { body: [] },
        'GET /aspects': { body: [] },
      });
      renderApp('/');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent).toEqual([]);
      vi.unstubAllGlobals();
    });
  });
});
