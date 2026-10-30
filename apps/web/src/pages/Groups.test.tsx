import type { Group } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  aliceUser,
  bob,
  makeAccount,
  makeNotification,
  makeStatus,
  nextId,
} from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: nextId(),
    handle: 'gardeners',
    name: 'Gardeners',
    privacy: 'public',
    avatarUrl: null,
    headerUrl: null,
    description: 'Plants and soil',
    url: 'https://disbigle.test/groups/gardeners',
    membersCount: 12,
    createdAt: '2026-10-01T10:00:00.000Z',
    membership: null,
    ...overrides,
  };
}

const base = {
  'GET /me': { body: aliceUser },
  'GET /instance': instance(),
};

describe('groups', () => {
  it('lists your groups and others, and creates a new one', async () => {
    const mine = makeGroup({ membership: { role: 'member', state: 'member' } });
    const other = makeGroup({ handle: 'cyclists', name: 'Cyclists', privacy: 'private' });
    const created = makeGroup({
      handle: 'book_club',
      name: 'Book club',
      membership: { role: 'admin', state: 'member' },
      membersCount: 1,
    });
    const fetchMock = mockApi({
      ...base,
      'GET /groups': (_body, url) => ({
        body:
          url.searchParams.get('scope') === 'mine'
            ? [mine]
            : url.searchParams.get('scope') === 'invited'
              ? []
              : [mine, other],
      }),
      'POST /groups': { status: 201, body: created },
      [`GET /groups/${created.handle}`]: { body: created },
      [`GET /groups/${created.id}/timeline`]: { body: [] },
    });
    const { router } = renderApp('/groups');
    const user = userEvent.setup();
    const discover = await screen.findByRole('list', { name: 'Discover groups' });
    expect(within(discover).getByRole('link', { name: 'Cyclists' })).toBeInTheDocument();
    expect(within(discover).getByText('Private group')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create group' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Book club');
    // The address follows the name until edited.
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('book_club');
    await user.click(screen.getByRole('radio', { name: /Secret group/ }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/book_club'));
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/v1/groups' && init?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      name: 'Book club',
      handle: 'book_club',
      privacy: 'secret',
    });
    expect(await screen.findByRole('heading', { name: 'Book club', level: 1 })).toBeVisible();
  });

  it('lets you join a public group and write in it', async () => {
    const group = makeGroup();
    const post = makeStatus({
      content: '<p>Tomatoes are ready</p>',
      group: {
        id: group.id,
        handle: group.handle,
        name: group.name,
        privacy: 'public',
        avatarUrl: null,
      },
    });
    const fetchMock = mockApi({
      ...base,
      [`GET /groups/${group.handle}`]: { body: group },
      [`GET /groups/${group.id}/timeline`]: { body: [post] },
      [`POST /groups/${group.id}/join`]: {
        body: { ...group, membership: { role: 'member', state: 'member' }, membersCount: 13 },
      },
      'POST /statuses': (body) => ({
        status: 201,
        body: makeStatus({ content: '<p>Hello</p>', group: post.group, ...(body as object) }),
      }),
    });
    renderApp(`/groups/${group.handle}`);
    const user = userEvent.setup();
    expect(await screen.findByText('Tomatoes are ready')).toBeInTheDocument();
    // On the group's own page, posts don't repeat which group they are in.
    expect(screen.queryByRole('link', { name: 'In Gardeners' })).not.toBeInTheDocument();
    expect(screen.getByText('Join the group to write and comment here.')).toBeInTheDocument();
    expect(screen.getByText('On the fediverse: @gardeners@disbigle.test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Join group' }));
    const composer = await screen.findByRole('textbox', { name: 'New post' });
    expect(screen.getByText('Posting in Gardeners: anyone can read it')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share with/ })).not.toBeInTheDocument();
    await user.type(composer, 'Hello');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/v1/statuses' && init?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        content: 'Hello',
        groupId: group.id,
      });
    });
  });

  it('keeps a private group closed and lets you ask to join', async () => {
    const group = makeGroup({ privacy: 'private' });
    mockApi({
      ...base,
      [`GET /groups/${group.handle}`]: { body: group },
      [`POST /groups/${group.id}/join`]: {
        body: { ...group, membership: { role: 'member', state: 'requested' } },
      },
    });
    renderApp(`/groups/${group.handle}`);
    const user = userEvent.setup();
    expect(
      await screen.findByText(
        'Only members see the posts of this group. Ask to join to take part.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Request sent: a moderator will look at it.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument();
  });

  it('shows moderators the requests to join', async () => {
    const group = makeGroup({
      privacy: 'private',
      membership: { role: 'admin', state: 'member' },
      requestsCount: 1,
    });
    const carol = makeAccount({ username: 'carol', displayName: 'Carol' });
    const fetchMock = mockApi({
      ...base,
      [`GET /groups/${group.handle}`]: { body: group },
      [`GET /groups/${group.id}/timeline`]: { body: [] },
      [`GET /groups/${group.id}/members`]: (_body, url) => ({
        body:
          url.searchParams.get('state') === 'requested'
            ? [{ account: carol, role: 'member', state: 'requested', createdAt: '' }]
            : [],
      }),
      [`POST /groups/${group.id}/members/${carol.id}/approve`]: { body: { status: 'ok' } },
    });
    renderApp(`/groups/${group.handle}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /Requests/ }));
    expect(await screen.findByText('Carol')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/members/${carol.id}/approve`)),
      ).toBe(true),
    );
    // Admins also get the settings tab.
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('says which group a post comes from elsewhere', async () => {
    const post = makeStatus({
      account: bob,
      content: '<p>Meeting on Friday</p>',
      group: {
        id: nextId(),
        handle: 'cyclists',
        name: 'Cyclists',
        privacy: 'private',
        avatarUrl: null,
      },
      visibility: 'limited',
    });
    mockApi({ ...base, 'GET /timelines/home': { body: [post] } });
    renderApp('/');
    const link = await screen.findByRole('link', { name: 'In Cyclists' });
    expect(link).toHaveAttribute('href', '/groups/cyclists');
    // Not the aspects badge of limited posts.
    expect(screen.queryByText('Shared with aspects')).not.toBeInTheDocument();
  });

  it('accepts a group invitation from the notifications', async () => {
    const group = makeGroup({ privacy: 'secret', name: 'Book club', handle: 'book_club' });
    const fetchMock = mockApi({
      ...base,
      'GET /notifications': {
        body: [
          makeNotification({
            type: 'group_invite',
            account: bob,
            status: null,
            group: {
              id: group.id,
              handle: group.handle,
              name: group.name,
              privacy: 'secret',
              avatarUrl: null,
            },
          }),
        ],
      },
      'POST /notifications/read': { body: { status: 'ok' } },
      [`POST /groups/${group.id}/join`]: {
        body: { ...group, membership: { role: 'member', state: 'member' } },
      },
    });
    renderApp('/notifications');
    const user = userEvent.setup();
    expect(await screen.findByText('invited you to Book club')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Book club' })).toHaveAttribute(
      'href',
      '/groups/book_club',
    );
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('You joined the group.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/groups/${group.id}/join`)),
    ).toBe(true);
  });
  it('lets admins change the pictures from the group page and name moderators', async () => {
    const group = makeGroup({ membership: { role: 'admin', state: 'member' } });
    const carol = makeAccount({ username: 'carol', displayName: 'Carol' });
    const fetchMock = mockApi({
      ...base,
      [`GET /groups/${group.handle}`]: { body: group },
      [`GET /groups/${group.id}/timeline`]: { body: [] },
      [`POST /groups/${group.id}/header`]: {
        body: { ...group, headerUrl: 'https://disbigle.test/header.webp' },
      },
      [`GET /groups/${group.id}/members`]: {
        body: [
          { account: aliceUser.account, role: 'admin', state: 'member', createdAt: '' },
          { account: carol, role: 'member', state: 'member', createdAt: '' },
        ],
      },
      [`PATCH /groups/${group.id}/members/${carol.id}`]: { body: { status: 'ok' } },
    });
    renderApp(`/groups/${group.handle}`);
    const user = userEvent.setup();
    const cover = await screen.findByLabelText('Change the cover');
    expect(screen.getByLabelText('Change the group picture')).toBeInTheDocument();
    await user.upload(cover, new File(['x'], 'cover.png', { type: 'image/png' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`/groups/${group.id}/header`) && init?.method === 'POST',
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole('tab', { name: /Members/ }));
    expect(await screen.findByText(/To name a moderator/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role of Carol' }), 'moderator');
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith(`/members/${carol.id}`) && init?.method === 'PATCH',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ role: 'moderator' });
    });
  });

  it('shows no pencils to plain members', async () => {
    const group = makeGroup({ membership: { role: 'member', state: 'member' } });
    mockApi({
      ...base,
      [`GET /groups/${group.handle}`]: { body: group },
      [`GET /groups/${group.id}/timeline`]: { body: [] },
    });
    renderApp(`/groups/${group.handle}`);
    expect(await screen.findByRole('heading', { name: 'Gardeners', level: 1 })).toBeVisible();
    expect(screen.queryByLabelText('Change the cover')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Change the group picture')).not.toBeInTheDocument();
  });
});
