import type { Album, ProfileMedia } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, bob, nextId, relationship } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const photo = (overrides: Partial<ProfileMedia> = {}): ProfileMedia => {
  const id = nextId();
  return {
    media: {
      id,
      type: 'image',
      url: `https://disbigle.test/media/${id}.png`,
      previewUrl: `https://disbigle.test/media/${id}-small.png`,
      description: '',
      width: 100,
      height: 100,
      blurhash: null,
    },
    statusId: nextId(),
    sensitive: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
};

const album = (overrides: Partial<Album> = {}): Album => ({
  id: nextId(),
  accountId: aliceUser.account.id,
  name: 'Seaside',
  description: '',
  mediaCount: 0,
  cover: null,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('photos and albums', () => {
  it('shows the photos of a profile and puts one of yours in an album', async () => {
    const sea = photo({ media: { ...photo().media, description: 'The sea at dawn' } });
    const seaside = album();
    let included = false;
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/alice': { body: aliceUser.account },
      [`GET /accounts/${aliceUser.account.id}/statuses`]: { body: [] },
      [`GET /accounts/${aliceUser.account.id}/media`]: { body: [sea] },
      [`GET /accounts/${aliceUser.account.id}/albums`]: (_body, url) => ({
        body: [
          url.searchParams.get('mediaId') === sea.media.id
            ? { ...seaside, includes: included }
            : seaside,
        ],
      }),
      [`PUT /albums/${seaside.id}/media/${sea.media.id}`]: () => {
        included = true;
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/@alice');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Media' }));
    await user.click(await screen.findByRole('button', { name: 'Open image: The sea at dawn' }));
    const viewer = await screen.findByRole('dialog', { name: 'Image viewer' });
    expect(within(viewer).getByRole('link', { name: 'Open the post' })).toHaveAttribute(
      'href',
      `/@alice/${sea.statusId}`,
    );
    await user.click(within(viewer).getByRole('button', { name: 'Add to album' }));
    await user.click(await within(viewer).findByRole('checkbox', { name: 'Seaside' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/v1/albums/${seaside.id}/media/${sea.media.id}` &&
            init?.method === 'PUT',
        ),
      ).toBe(true),
    );
    expect(await within(viewer).findByRole('checkbox', { name: 'Seaside' })).toBeChecked();
  });

  it("lists someone else's albums and opens one, without editing controls", async () => {
    const sea = photo();
    const trip = album({
      accountId: bob.id,
      name: 'Summer trip',
      mediaCount: 1,
      cover: sea.media,
    });
    const bobLocal = { ...bob, local: true };
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/bob': { body: bobLocal },
      'GET /accounts/relationships': { body: [relationship(bob.id)] },
      [`GET /accounts/${bob.id}/statuses`]: { body: [] },
      [`GET /accounts/${bob.id}/albums`]: { body: [trip] },
      [`GET /albums/${trip.id}`]: { body: { ...trip, account: bobLocal, items: [sea] } },
    });
    renderApp('/@bob');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Albums' }));
    expect(screen.queryByRole('button', { name: 'New album' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('link', { name: /Summer trip/ }));
    expect(await screen.findByRole('heading', { name: 'Summer trip' })).toBeInTheDocument();
    expect(screen.getByText('1 item')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete album' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open image' })).toHaveLength(1);
  });

  it('creates an album from your profile', async () => {
    let albums: Album[] = [];
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /accounts/lookup/alice': { body: aliceUser.account },
      [`GET /accounts/${aliceUser.account.id}/statuses`]: { body: [] },
      [`GET /accounts/${aliceUser.account.id}/albums`]: () => ({ body: albums }),
      'POST /albums': (body) => {
        const created = album({ name: (body as { name: string }).name });
        albums = [created];
        return { status: 201, body: created };
      },
    });
    renderApp('/@alice');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Albums' }));
    expect(await screen.findByText('No albums yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New album' }));
    const dialog = await screen.findByRole('dialog', { name: 'New album' });
    await user.type(within(dialog).getByLabelText('Name'), 'Mountains');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('link', { name: /Mountains/ })).toBeInTheDocument();
  });
});
