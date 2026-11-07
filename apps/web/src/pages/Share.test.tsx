import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../test/fixtures.ts';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

const link = 'Una notizia https://disbigle.com/2026/x';

describe('sharing from other sites', () => {
  it('opens the composer with the shared text', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp(`/share?text=${encodeURIComponent(link)}`);
    expect(await screen.findByRole('heading', { name: 'Share on Disbigle' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New post' })).toHaveValue(`${link} `);
  });

  it('asks to sign in first, then comes back', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance() });
    const { router } = renderApp(`/share?text=${encodeURIComponent(link)}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({
      redirect: `/share?text=${encodeURIComponent(link)}`,
    });
  });
});
