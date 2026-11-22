import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AdminUser, AdminUserDetail } from '../../api/admin.ts';
import { makeAccount, withRole } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

const renAccount = makeAccount({ username: 'Renyh', displayName: 'Ren' });

const renRow: AdminUser = {
  userId: 'u-ren',
  actorId: renAccount.id,
  username: 'Renyh',
  displayName: 'Ren',
  avatarUrl: null,
  email: 'renyh@disbigle.com',
  role: 'user',
  approved: true,
  emailVerified: false,
  locale: 'en',
  createdAt: '2026-11-14T08:00:00.000Z',
  lastSignInAt: null,
  lastActiveAt: null,
  lastIp: null,
  posts: 0,
  followers: 0,
  following: 0,
  twoFactor: false,
  suspended: false,
  disabled: false,
  deletionRequested: false,
};

const renDetail: AdminUserDetail = {
  userId: 'u-ren',
  account: renAccount,
  email: 'renyh@disbigle.com',
  emailVerifiedAt: null,
  approved: true,
  role: 'user',
  locale: 'en',
  totp: false,
  passkeys: 0,
  createdAt: '2026-11-14T08:00:00.000Z',
  lastSignInAt: null,
  reason: 'I write about video games and want to follow other players.',
  suspended: false,
  disabled: false,
  deletionRequested: false,
  log: [],
};

describe('administration', () => {
  it('is a menu item of its own after moderation, for administrators', async () => {
    mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
    });
    renderApp('/');
    const [moderation] = await screen.findAllByRole('link', { name: /Moderation/ });
    const [administration] = await screen.findAllByRole('link', { name: 'Administration' });
    if (!moderation || !administration) throw new Error('Menu items missing');
    expect(moderation).toHaveAttribute('href', '/moderation');
    expect(administration).toHaveAttribute('href', '/admin');
    // Administration comes after moderation in the menu.
    expect(
      moderation.compareDocumentPosition(administration) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('sends old moderation links to their new place', async () => {
    mockApi({
      'GET /me': { body: withRole('moderator') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/pending': { body: [] },
    });
    const { router } = renderApp('/admin/pending');
    await waitFor(() => expect(router.state.location.pathname).toBe('/moderation/pending'));
  });

  it('finds unconfirmed people, corrects the address and confirms it', async () => {
    let detail = renDetail;
    const fetchMock = mockApi({
      'GET /me': { body: withRole('admin') },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'GET /admin/users': (_body, url) => ({
        body: url.searchParams.get('status') === 'unconfirmed' ? [renRow] : [],
      }),
      'GET /admin/users/u-ren': () => ({ body: detail }),
      'PATCH /admin/users/u-ren': (body) => {
        detail = { ...detail, ...(body as object) };
        return { body: detail };
      },
      'POST /admin/users/u-ren/resend_confirmation': { body: { status: 'ok' } },
      'POST /admin/users/u-ren/confirm_email': () => {
        detail = { ...detail, emailVerifiedAt: '2026-11-15T10:00:00.000Z' };
        return { body: { status: 'ok' } };
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await user.selectOptions(await screen.findByLabelText('Show'), 'unconfirmed');
    await user.click(await screen.findByRole('link', { name: 'Manage Ren' }));

    expect(
      await screen.findByText('I write about video games and want to follow other players.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Why they signed up')).toBeInTheDocument();
    const email = await screen.findByLabelText('Email address');
    await user.clear(email);
    await user.type(email, '798682951@qq.com');
    await user.selectOptions(screen.getByLabelText('Language of emails and notifications'), 'zh');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      email: '798682951@qq.com',
      locale: 'zh',
    });

    await user.click(screen.getByRole('button', { name: 'Send the confirmation again' }));
    expect(
      await screen.findByText('Confirmation link sent to 798682951@qq.com.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm the email by hand' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText('Email address confirmed: the account can sign in.'),
    ).toBeInTheDocument();
    // Confirmed: the confirmation buttons are gone.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Send the confirmation again' }),
      ).not.toBeInTheDocument(),
    );
  });
});
