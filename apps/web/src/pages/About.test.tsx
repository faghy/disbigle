import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instance, mockApi, renderApp, signedOut } from '../test/utils.tsx';

const withRules = (mode: 'open' | 'invite' = 'open') => {
  const base = instance(mode);
  return {
    body: {
      ...base.body,
      title: 'Disbigle Italia',
      description: 'Il social federato',
      rules: ['Be kind', 'No spam'],
      contactEmail: 'admin@example.com',
    },
  };
};

describe('about and rules', () => {
  it('shows the server, its rules and contact on the about page', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': withRules() });
    renderApp('/about');
    expect(await screen.findByRole('heading', { name: 'Disbigle Italia' })).toBeInTheDocument();
    const rules = screen.getByRole('list', { name: 'Rules' });
    expect(
      within(rules)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['1Be kind', '2No spam']);
    expect(screen.getByRole('link', { name: 'admin@example.com' })).toHaveAttribute(
      'href',
      'mailto:admin@example.com',
    );
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Disbigle' }),
    ).toHaveAttribute('href', 'https://github.com/faghy/disbigle');
    expect(screen.getByText(/ActivityPub and diaspora\*/)).toBeInTheDocument();
  });

  it('shows the rules above the agreement at registration', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': withRules() });
    renderApp('/register');
    const rules = await screen.findByRole('list', { name: 'Rules of disbigle.test' });
    expect(within(rules).getByText('No spam')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'I agree to the rules above and the privacy policy of disbigle.test',
      }),
    ).toBeInTheDocument();
  });

  it('fills in the invitation code from the link', async () => {
    const fetchMock = mockApi({
      'GET /me': signedOut,
      'GET /instance': withRules('invite'),
      'POST /auth/register': { status: 202, body: { status: 'pending_approval' } },
    });
    renderApp('/register?invite=abc123XYZ');
    const user = userEvent.setup();
    expect(await screen.findByLabelText('Invitation code')).toHaveValue('abc123XYZ');
    await user.type(screen.getByLabelText('Username'), 'newbie');
    await user.type(screen.getByLabelText('Email'), 'newbie@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Almost there' });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/register'));
    expect(JSON.parse(String(call?.[1]?.body)).inviteCode).toBe('abc123XYZ');
  });

  it('links to the about page from the footer', async () => {
    mockApi({ 'GET /me': signedOut, 'GET /instance': withRules() });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
  });
});
