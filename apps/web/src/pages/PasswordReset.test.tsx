import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

const token = 'a'.repeat(32);

describe('password reset', () => {
  it('sets a new password and returns to sign in with a confirmation', async () => {
    const fetchMock = mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/password/reset': { body: { status: 'ok' } },
    });
    const { router } = renderApp(`/reset-password?token=${token}`);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('New password'), 'a brand new password');
    await user.type(screen.getByLabelText('Confirm new password'), 'something else');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription(
      'The passwords do not match.',
    );

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'a brand new password');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(
      await screen.findByText('Your password has been changed. Sign in with your new password.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    const call = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/v1/auth/password/reset',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      token,
      password: 'a brand new password',
    });
  });

  it('explains an expired link and offers a new one', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/password/reset': {
        status: 400,
        body: { error: 'bad_request', message: 'This reset link is invalid or has expired' },
      },
    });
    renderApp(`/reset-password?token=${token}`);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a brand new password');
    await user.type(screen.getByLabelText('Confirm new password'), 'a brand new password');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(
      await screen.findByText('This reset link is invalid, has already been used or has expired.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('links to the reset request from the sign-in page', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/password/forgot': { body: { status: 'ok' } },
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    await user.type(await screen.findByLabelText('Email'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account uses alice@example.com, a reset link is on its way.',
    );
  });
});
