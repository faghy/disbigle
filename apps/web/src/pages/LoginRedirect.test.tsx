import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fullNavigation } from '../lib/redirect.ts';
import { aliceUser } from '../test/fixtures.ts';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

const authorize = '/oauth/authorize?client_id=tusky&redirect_uri=urn%3Aietf&scope=read+write';
const loginWithRedirect = `/login?redirect=${encodeURIComponent(authorize)}`;

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email or username'), 'alice');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in redirects (OAuth)', () => {
  it('goes to the requested server page with a full navigation after signing in', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    let signedIn = false;
    mockApi({
      'GET /me': () => (signedIn ? { body: aliceUser } : signedOut),
      'GET /instance': instance(),
      'POST /auth/login': () => {
        signedIn = true;
        return { body: { status: 'ok' } };
      },
    });
    const { router } = renderApp(loginWithRedirect);
    await signIn(userEvent.setup());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
    expect(router.state.location.pathname).toBe('/login');
  });

  it('also continues after the second factor', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/login': { body: { status: 'mfa_required', methods: ['totp'] } },
      'POST /auth/mfa': { body: { status: 'ok' } },
    });
    renderApp(loginWithRedirect);
    const user = userEvent.setup();
    await signIn(user);
    await user.type(await screen.findByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
  });

  it('ignores unsafe targets and stays in the app', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    let signedIn = false;
    mockApi({
      'GET /me': () => (signedIn ? { body: aliceUser } : signedOut),
      'GET /instance': instance(),
      'POST /auth/login': () => {
        signedIn = true;
        return { body: { status: 'ok' } };
      },
    });
    const { router } = renderApp(`/login?redirect=${encodeURIComponent('//evil.example/steal')}`);
    await signIn(userEvent.setup());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends visitors who are already signed in straight to the target', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp(loginWithRedirect);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
  });

  it('still sends signed-in visitors home when there is no target', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    const { router } = renderApp('/login?redirect=https%3A%2F%2Fevil.example');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('carries the target through registration', async () => {
    const assign = vi.spyOn(fullNavigation, 'assign').mockImplementation(() => {});
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/register': { status: 201, body: { status: 'ok', user: aliceUser } },
    });
    renderApp(loginWithRedirect);
    const user = userEvent.setup();
    const link = await screen.findByRole('link', { name: 'Create an account' });
    expect(link).toHaveAttribute('href', `/register?redirect=${encodeURIComponent(authorize)}`);
    await user.click(link);

    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent(authorize)}`,
    );
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
  });
});
