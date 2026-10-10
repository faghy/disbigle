import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser } from '../../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../../test/utils.tsx';

describe('account settings', () => {
  it('offers the data export as a download', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp('/settings/account');
    const link = await screen.findByRole('link', { name: 'Download your data' });
    expect(link).toHaveAttribute('href', '/api/v1/me/export');
    expect(link).toHaveAttribute('download');
  });

  it('deletes the account only after the password is confirmed', async () => {
    let deleted = false;
    const fetchMock = mockApi({
      'GET /me': () =>
        deleted
          ? { status: 401, body: { error: 'unauthorized', message: 'Sign in required' } }
          : { body: aliceUser },
      'GET /instance': instance(),
      'POST /me/delete': (body) => {
        if ((body as { password: string }).password !== 'correct horse battery')
          return { status: 403, body: { error: 'wrong_password', message: 'Wrong password' } };
        deleted = true;
        return { body: { status: 'ok' } };
      },
    });
    const { router } = renderApp('/settings/account');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete account permanently' });

    await user.click(confirm);
    expect(within(dialog).getByLabelText('Current password')).toHaveAccessibleDescription(
      'This field is required.',
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/v1/me/delete')).toBe(false);

    await user.type(within(dialog).getByLabelText('Current password'), 'nope');
    await user.click(confirm);
    expect(await within(dialog).findByText('Wrong password.')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Current password'));
    await user.type(within(dialog).getByLabelText('Current password'), 'correct horse battery');
    await user.click(confirm);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'disbigle.test' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains why the last administrator cannot leave', async () => {
    mockApi({
      'GET /me': { body: { ...aliceUser, role: 'admin' } },
      'GET /instance': instance(),
      'GET /admin/summary': { body: { pendingUsers: 0, openReports: 0 } },
      'POST /me/delete': {
        status: 403,
        body: { error: 'forbidden', message: 'The last administrator cannot delete their account' },
      },
    });
    renderApp('/settings/account');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Current password'), 'whatever');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account permanently' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You are the last administrator.',
    );
  });
});
