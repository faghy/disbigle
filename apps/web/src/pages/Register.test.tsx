import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

describe('register page', () => {
  it('asks for an invitation code in invite mode', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance('invite') });
    renderApp('/register');
    expect(await screen.findByLabelText('Invitation code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why do you want to join?')).not.toBeInTheDocument();
  });

  it('asks why in approval mode and shows the pending state on 202', async () => {
    const fetchMock = mockApi({
      'GET /me': signedOut,
      'GET /instance': instance('approval'),
      'POST /auth/register': { status: 202, body: { status: 'pending_approval' } },
    });
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.type(screen.getByLabelText('Why do you want to join?'), 'Friends are here');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Almost there' })).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/register'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      password: 'a long enough password',
      locale: 'en',
      reason: 'Friends are here',
      agreement: true,
    });
  });

  it('shows field errors returned by the server', async () => {
    mockApi({
      'GET /me': signedOut,
      'GET /instance': instance(),
      'POST /auth/register': {
        status: 409,
        body: { error: 'username_taken', message: 'This username is already taken' },
      },
    });
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This username is already taken.');
  });

  it('validates the form on the client first', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance() });
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'not valid!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(
      'Use 1 to 30 letters, digits or underscores.',
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      'You must accept the rules to continue.',
    );
  });

  it('explains when registrations are closed', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': instance('closed') });
    renderApp('/register');
    expect(
      await screen.findByRole('heading', { name: 'Registrations are closed' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it('sends the solved anti-robot challenge with the registration', async () => {
    const fetchMock = mockApi({
      'GET /me': signedOut,
      'GET /instance': instance('open'),
      'GET /auth/register/challenge': {
        body: { challenge: 'signed-challenge', salt: 'salt', difficulty: 4 },
      },
      'POST /auth/register': { status: 202, body: { status: 'pending_approval' } },
    });
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByRole('heading', { name: 'Almost there' });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/register'));
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.challenge).toBe('signed-challenge');
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`salt:${body.nonce}`),
    );
    expect((new Uint8Array(digest)[0] ?? 255) >> 4).toBe(0);
    expect(body).not.toHaveProperty('website');
  });
});
