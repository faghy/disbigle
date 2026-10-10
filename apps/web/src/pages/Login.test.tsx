import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

const currentUser = {
  account: {
    id: '1',
    username: 'alice',
    acct: 'alice',
    displayName: 'Alice Liddell',
    note: '',
    avatarUrl: null,
    headerUrl: null,
    fields: [],
    locked: false,
    bot: false,
    discoverable: true,
    local: true,
    url: null,
    createdAt: '2026-10-11T00:00:00.000Z',
  },
  email: 'alice@example.com',
  role: 'user',
  locale: 'en',
  totpEnabled: true,
  passkeyCount: 0,
};

describe('login page', () => {
  it('shows field errors without calling the API when the form is empty', async () => {
    const fetchMock = mockApi({ 'GET /me': signedOut, 'GET /instance': instance() });
    renderApp('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(screen.getByLabelText('Email or username')).toHaveAccessibleDescription(
      'This field is required.',
    );
    expect(screen.getByLabelText('Email or username')).toHaveFocus();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/login'))).toBe(false);
  });

  it('asks for a second factor on mfa_required and completes with a TOTP code', async () => {
    let signedIn = false;
    const fetchMock = mockApi({
      'GET /me': () => (signedIn ? { body: currentUser } : signedOut),
      'GET /instance': instance(),
      'POST /auth/login': { body: { status: 'mfa_required', methods: ['totp', 'recovery_code'] } },
      'POST /auth/mfa': (body) => {
        signedIn = (body as { code: string }).code === '123456';
        return signedIn
          ? { body: { status: 'ok' } }
          : { status: 401, body: { error: 'invalid_mfa_code', message: 'Invalid code' } };
      },
    });
    renderApp('/login');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Email or username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const codeInput = await screen.findByLabelText('Authentication code');
    expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument();

    await user.type(codeInput, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');

    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use your authenticator app instead' }));

    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Your home timeline is empty')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/mfa',
      expect.objectContaining({ body: JSON.stringify({ code: '123456' }) }),
    );
  });

  it('offers a passkey as second factor when the server lists it', async () => {
    // jsdom has no WebAuthn; pretend the browser supports it.
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/login': {
        body: { status: 'mfa_required', methods: ['totp', 'recovery_code', 'passkey'] },
      },
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email or username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Use a passkey' })).toBeInTheDocument();
    Reflect.deleteProperty(window, 'PublicKeyCredential');
  });

  it('shows a translated error for wrong credentials', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/login': {
        status: 401,
        body: { error: 'invalid_credentials', message: 'Invalid login or password' },
      },
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email or username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Wrong login or password.'),
    );
  });

  it('redirects signed-in users to the home page', async () => {
    mockApi({ 'GET /me': { body: currentUser }, 'GET /instance': instance() });
    const { router } = renderApp('/login');
    expect(await screen.findByText('Your home timeline is empty')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
