import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

describe('confirming the email address', () => {
  it('asks to check the mailbox after signing up', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/register': {
        status: 202,
        body: { status: 'pending_verification', approval: true },
      },
    });
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toHaveTextContent('a moderator will approve it');
  });

  it('confirms with the emailed link', async () => {
    let sent: unknown;
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/email/verify': (body) => {
        sent = body;
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(sent).toEqual({ token: 'abcdefghijklmnopqrstuvwxyz' });
  });

  it('offers to send the link again when signing in too early', async () => {
    let resent: unknown;
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/login': {
        status: 403,
        body: { error: 'email_not_verified', message: 'Confirm your email address first' },
      },
      'POST /auth/email/resend': (body) => {
        resent = body;
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email or username'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }));
    await waitFor(() => expect(resent).toEqual({ login: 'alice' }));
    expect(await screen.findByText(/the link is on its way/)).toBeInTheDocument();
  });
});
