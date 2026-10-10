import { MAX_POST_LENGTH } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeStatus, nextId } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const family = { id: nextId(), name: 'Family', memberCount: 2 };
const friends = { id: nextId(), name: 'Friends', memberCount: 5 };

function signedInApi(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /me': { body: aliceUser },
    'GET /instance': instance(),
    'GET /aspects': { body: [family, friends] },
    ...extra,
  });
}

const postCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url) === '/api/v1/statuses' && init?.method === 'POST',
  );

describe('composer', () => {
  it('counts the characters left', async () => {
    signedInApi();
    renderApp('/');
    const user = userEvent.setup();
    const textbox = await screen.findByRole('textbox', { name: 'New post' });
    await user.type(textbox, 'Hello');
    const counter = screen.getByText(`${MAX_POST_LENGTH - 5} characters left`);
    expect(counter.parentElement).toHaveTextContent(String(MAX_POST_LENGTH - 5));
    // The textarea is described by the counter, so screen readers hear what is left.
    expect(textbox).toHaveAccessibleDescription(`${MAX_POST_LENGTH - 5} characters left`);
  });

  it('disables posting past the limit', async () => {
    signedInApi();
    renderApp('/');
    const user = userEvent.setup();
    const textbox = await screen.findByRole('textbox', { name: 'New post' });
    await user.click(textbox);
    await user.paste('x'.repeat(MAX_POST_LENGTH + 3));
    expect(screen.getByText('-3 characters left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('requires at least one aspect when sharing with aspects', async () => {
    const fetchMock = signedInApi({
      'POST /statuses': (body) => ({
        status: 201,
        body: makeStatus({ ...(body as object), content: '<p>Just us</p>' }),
      }),
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'New post' }), 'Just us');

    await user.click(screen.getByRole('button', { name: /Share with/ }));
    await user.click(screen.getByRole('radio', { name: /^Aspects/ }));
    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByText('Choose at least one aspect.')).toBeInTheDocument();
    expect(postCalls(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Share with/ }));
    await user.click(screen.getByRole('checkbox', { name: /Friends/ }));
    expect(screen.getByRole('button', { name: /Share with/ })).toHaveTextContent('Friends');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(postCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      content: 'Just us',
      visibility: 'limited',
      aspectIds: [friends.id],
    });
    expect(screen.queryByText('Choose at least one aspect.')).not.toBeInTheDocument();
  });

  it('uploads media and saves its description before posting', async () => {
    const mediaId = nextId();
    const uploads: FormData[] = [];
    const fetchMock = signedInApi({
      'POST /media': (form) => {
        uploads.push(form as FormData);
        return {
          status: 201,
          body: {
            id: mediaId,
            type: 'image',
            url: '/media/red.png',
            previewUrl: null,
            description: '',
            width: 64,
            height: 32,
            blurhash: null,
          },
        };
      },
      [`PUT /media/${mediaId}`]: (body) => ({
        body: { id: mediaId, description: (body as { description: string }).description },
      }),
      'POST /statuses': (body) => ({ status: 201, body: makeStatus(body as object) }),
    });
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'New post' });

    const file = new File(['png'], 'red.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('composer-file-input'), file);
    const attachments = await screen.findByRole('list', { name: 'Attached media' });
    expect(uploads[0]?.get('description')).toBe('');
    expect([...(uploads[0]?.keys() ?? [])]).toEqual(['description', 'file']);

    await user.click(await within(attachments).findByRole('button', { name: 'Add description' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Description of attachment 1' }),
      'A red rectangle',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(within(attachments).getByRole('img')).toHaveAccessibleName('A red rectangle');

    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1));

    const order = fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`);
    const put = order.indexOf(`PUT /api/v1/media/${mediaId}`);
    expect(put).toBeGreaterThan(-1);
    expect(put).toBeLessThan(order.indexOf('POST /api/v1/statuses'));
    expect(JSON.parse(String(postCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      mediaIds: [mediaId],
      visibility: 'public',
    });
  });

  it('rejects files that are too large', async () => {
    signedInApi();
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'New post' });
    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 17 * 1024 * 1024 });
    await user.upload(screen.getByTestId('composer-file-input'), big);
    expect(await screen.findByText('huge.png is larger than 16 MB.')).toBeInTheDocument();
  });
});
