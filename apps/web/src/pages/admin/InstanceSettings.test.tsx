import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const settings = {
  title: 'Disbigle Test',
  description: 'A test server',
  registrationMode: 'open',
  rules: ['Be kind', 'No spam'],
  contactEmail: 'admin@example.com',
  welcomeAccount: '',
  welcomeAspect: '',
  welcomeMessage: '',
  welcomeFollowBack: true,
  welcomeMessages: {},
};

describe('instance settings', () => {
  it('lets an administrator edit, reorder and save the settings', async () => {
    let saved: unknown;
    mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/settings': { body: settings },
      'PUT /admin/settings': (body) => {
        saved = body;
        return { body: { ...settings, ...(body as object) } };
      },
    });
    renderApp('/admin/instance');
    const user = userEvent.setup();

    const title = await screen.findByRole('textbox', { name: 'Server name' });
    await user.clear(title);
    await user.type(title, 'Disbigle Italia');
    await user.click(screen.getByRole('radio', { name: /Invitation only/ }));
    await user.click(screen.getByRole('button', { name: 'Move rule 2 up' }));
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByRole('textbox', { name: 'Rule 3' }), 'Use content warnings');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByRole('textbox', { name: 'Welcome account' }), '@faghy');
    await user.type(screen.getByRole('textbox', { name: 'Aspect' }), 'Fediverso');
    await user.type(screen.getByRole('textbox', { name: 'Welcome message' }), 'Benvenuto!');
    // The same message in Spanish, for people who use Disbigle in Spanish.
    await user.selectOptions(screen.getByLabelText('Version of the message'), 'es');
    await user.type(
      screen.getByRole('textbox', { name: 'Welcome message in Español' }),
      '¡Bienvenido!',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Your changes have been saved.')).toBeInTheDocument();
    // The empty fourth rule is dropped.
    expect(saved).toEqual({
      title: 'Disbigle Italia',
      description: 'A test server',
      registrationMode: 'invite',
      rules: ['No spam', 'Be kind', 'Use content warnings'],
      contactEmail: 'admin@example.com',
      welcomeAccount: 'faghy',
      welcomeAspect: 'Fediverso',
      welcomeMessage: 'Benvenuto!',
      welcomeFollowBack: true,
      welcomeMessages: { es: '¡Bienvenido!' },
    });
  });

  it('turns the welcome account into a one-way follow and adds it to earlier members', async () => {
    let saved: Record<string, unknown> = {};
    let followedByAll = false;
    mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/settings': { body: { ...settings, welcomeAccount: 'disbigle' } },
      'PUT /admin/settings': (body) => {
        saved = body as Record<string, unknown>;
        return { body: { ...settings, ...(body as object) } };
      },
      'POST /admin/welcome/follow_all': () => {
        followedByAll = true;
        return { body: { added: 42 } };
      },
    });
    renderApp('/admin/instance');
    const user = userEvent.setup();
    const followBack = await screen.findByRole('checkbox', {
      name: /The welcome account follows newcomers back/,
    });
    await user.click(followBack);
    // Without the follow back there is no aspect to choose.
    expect(screen.queryByRole('textbox', { name: 'Aspect' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved.welcomeFollowBack).toBe(false));

    await user.click(screen.getByRole('button', { name: 'Make everyone follow @disbigle' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Follow' }));
    expect(
      await screen.findByText('Done: 42 more people now follow @disbigle.'),
    ).toBeInTheDocument();
    expect(followedByAll).toBe(true);
  });

  it('checks the contact address before saving', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/settings': { body: settings },
    });
    renderApp('/admin/instance');
    const user = userEvent.setup();
    const email = await screen.findByRole('textbox', { name: 'Contact email' });
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(email).toHaveAccessibleDescription('Enter a valid email address.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('is only offered to administrators', async () => {
    mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/pending': { body: [] },
    });
    const { router } = renderApp('/admin/instance');
    await waitFor(() => expect(router.state.location.pathname).toBe('/moderation/pending'));
    const nav = screen.getByRole('navigation', { name: 'Moderation sections' });
    expect(within(nav).queryByRole('link', { name: 'Instance' })).not.toBeInTheDocument();
  });
});
