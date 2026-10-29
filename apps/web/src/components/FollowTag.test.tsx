import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

describe('followed hashtags', () => {
  it('follows a new hashtag from the list', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /aspects': { body: [] },
      'GET /tags/followed': { body: ['jazz'] },
      'POST /tags/linux/follow': { body: { name: 'linux', following: true, postsCount: 3 } },
    });
    renderApp('/');
    const user = userEvent.setup();
    const [field] = await screen.findAllByRole('textbox', { name: 'Follow a hashtag' });
    if (!field) throw new Error('no field');
    await user.type(field, '#Linux{Enter}');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/tags/linux/follow'),
      ).toBe(true),
    );
    expect((await screen.findAllByRole('link', { name: '#linux' })).length).toBeGreaterThan(0);
    expect(field).toHaveValue('');
  });
});
