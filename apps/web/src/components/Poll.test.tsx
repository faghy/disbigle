import type { Poll } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, makeStatus } from '../test/fixtures.ts';
import { instance, type MockResponse, mockApi, renderApp } from '../test/utils.tsx';

const inOneDay = () => new Date(Date.now() + 86_400_000).toISOString();

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: '01a12800-0000-7000-8000-000000000011',
    expiresAt: inOneDay(),
    expired: false,
    multiple: false,
    votesCount: 2,
    votersCount: 2,
    options: [
      { title: 'Tea', votesCount: 1 },
      { title: 'Coffee', votesCount: 1 },
      { title: 'Water', votesCount: 0 },
    ],
    voted: false,
    ownVotes: [],
    ...overrides,
  };
}

function deferred() {
  let release: (value: MockResponse) => void = () => {};
  const promise = new Promise<MockResponse>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const postCall = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.find(([url, init]) => String(url) === path && init?.method === 'POST');

describe('composer poll', () => {
  it('validates the options and sends the poll', async () => {
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'POST /statuses': (body) => ({ status: 201, body: makeStatus(body as object) }),
    });
    renderApp('/');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'New post' });

    await user.click(screen.getByRole('button', { name: 'Add a poll' }));
    expect(screen.getByRole('button', { name: 'Add a poll' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Polls and attachments do not mix.
    expect(screen.getByRole('button', { name: 'Add images, video or audio' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(screen.getByText('Write the question of your poll.')).toBeInTheDocument();
    expect(screen.getAllByText('Write this option or remove it.')).toHaveLength(2);
    expect(postCall(fetchMock, '/api/v1/statuses')).toBeUndefined();

    await user.type(screen.getByRole('textbox', { name: 'New post' }), 'Tea or coffee?');
    await user.type(screen.getByRole('textbox', { name: 'Option 1' }), 'Tea');
    await user.type(screen.getByRole('textbox', { name: 'Option 2' }), 'tea');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(screen.getByRole('textbox', { name: 'Option 2' })).toHaveAccessibleDescription(
      'This option is already in the poll.',
    );

    await user.clear(screen.getByRole('textbox', { name: 'Option 2' }));
    await user.type(screen.getByRole('textbox', { name: 'Option 2' }), 'Coffee');
    await user.click(screen.getByRole('button', { name: 'Add option' }));
    expect(screen.getByRole('button', { name: 'Remove option 1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Remove option 3' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ends in' }), '3 days');
    await user.click(screen.getByRole('radio', { name: 'Several answers' }));
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(postCall(fetchMock, '/api/v1/statuses')).toBeDefined());
    expect(JSON.parse(String(postCall(fetchMock, '/api/v1/statuses')?.[1]?.body))).toMatchObject({
      content: 'Tea or coffee?',
      mediaIds: [],
      poll: { options: ['Tea', 'Coffee'], expiresIn: 259_200, multiple: true },
    });
  });

  it('keeps at least two options', async () => {
    mockApi({ 'GET /me': { body: aliceUser }, 'GET /instance': instance() });
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a poll' }));
    expect(screen.getByRole('button', { name: 'Remove option 1' })).toBeDisabled();
  });
});

describe('voting', () => {
  it('votes in a single-choice poll and shows results at once', async () => {
    const poll = makePoll();
    const status = makeStatus({ content: '<p>Tea or coffee?</p>', poll });
    const response = deferred();
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      [`POST /polls/${poll.id}/votes`]: () => response.promise,
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');

    const vote = within(article).getByRole('button', { name: 'Vote' });
    expect(vote).toBeDisabled();
    expect(within(article).getAllByRole('radio')).toHaveLength(3);
    await user.click(within(article).getByRole('radio', { name: 'Coffee' }));
    await user.click(vote);

    // Optimistic: 1, 2 and 0 of 3 votes.
    const results = within(article).getByRole('list', { name: 'Poll results' });
    const rows = within(results).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('33%');
    expect(rows[1]).toHaveTextContent('67%');
    expect(rows[1]).toHaveTextContent('Your choice');
    expect(rows[2]).toHaveTextContent('0%');
    expect(within(article).getByText('3 people')).toBeInTheDocument();

    response.release({
      body: {
        ...status,
        poll: {
          ...poll,
          voted: true,
          ownVotes: [1],
          votesCount: 4,
          votersCount: 4,
          options: [
            { title: 'Tea', votesCount: 1 },
            { title: 'Coffee', votesCount: 3 },
            { title: 'Water', votesCount: 0 },
          ],
        },
      },
    });
    await waitFor(() =>
      expect(within(results).getAllByRole('listitem')[1]).toHaveTextContent('75%'),
    );
    expect(
      JSON.parse(String(postCall(fetchMock, `/api/v1/polls/${poll.id}/votes`)?.[1]?.body)),
    ).toEqual({
      choices: [1],
    });
  });

  it('sends several choices in a multiple-choice poll', async () => {
    const poll = makePoll({ multiple: true });
    const status = makeStatus({ poll });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      [`POST /polls/${poll.id}/votes`]: (body) => ({
        body: {
          ...status,
          poll: { ...poll, voted: true, ownVotes: (body as { choices: number[] }).choices },
        },
      }),
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    expect(within(article).getByText('You can choose more than one answer.')).toBeInTheDocument();
    await user.click(within(article).getByRole('checkbox', { name: 'Water' }));
    await user.click(within(article).getByRole('checkbox', { name: 'Tea' }));
    await user.click(within(article).getByRole('button', { name: 'Vote' }));

    await within(article).findByRole('list', { name: 'Poll results' });
    expect(
      JSON.parse(String(postCall(fetchMock, `/api/v1/polls/${poll.id}/votes`)?.[1]?.body)),
    ).toEqual({
      choices: [0, 2],
    });
    expect(within(article).getAllByText('Your choice')).toHaveLength(2);
  });

  it('goes back to the ballot when the vote fails', async () => {
    const poll = makePoll();
    const status = makeStatus({ poll });
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      [`POST /polls/${poll.id}/votes`]: {
        status: 500,
        body: { error: 'internal_error', message: 'boom' },
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');
    await user.click(within(article).getByRole('radio', { name: 'Tea' }));
    await user.click(within(article).getByRole('button', { name: 'Vote' }));
    expect(await within(article).findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(within(article).getByRole('button', { name: 'Vote' })).toBeInTheDocument();
    expect(within(article).getByRole('radio', { name: 'Tea' })).toBeChecked();
  });

  it('shows the final results of an ended poll, with a refresh', async () => {
    const poll = makePoll({
      expired: true,
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      votesCount: 4,
      votersCount: 4,
      options: [
        { title: 'Tea', votesCount: 3 },
        { title: 'Coffee', votesCount: 1 },
        { title: 'Water', votesCount: 0 },
      ],
    });
    const status = makeStatus({ poll });
    const fetchMock = mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /timelines/home': { body: [status] },
      [`GET /statuses/${status.id}`]: { body: status },
    });
    renderApp('/');
    const user = userEvent.setup();
    const article = await screen.findByRole('article');

    expect(within(article).queryByRole('button', { name: 'Vote' })).not.toBeInTheDocument();
    expect(within(article).getByText('Closed')).toBeInTheDocument();
    const rows = within(within(article).getByRole('list', { name: 'Poll results' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent('75%');
    expect(rows[0]).toHaveTextContent('3 votes');

    await user.click(within(article).getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === `/api/v1/statuses/${status.id}`),
      ).toBe(true),
    );
  });
});
