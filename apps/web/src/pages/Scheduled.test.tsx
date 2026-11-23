import type { ScheduledPost } from '@disbigle/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aliceUser, nextId } from '../test/fixtures.ts';
import { instance, mockApi, renderApp } from '../test/utils.tsx';

const localInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

const scheduled = (over: Partial<ScheduledPost> = {}): ScheduledPost => ({
  id: nextId(),
  scheduledAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
  params: {
    content: 'Più tardi',
    visibility: 'public',
    aspectIds: [],
    summary: '',
    sensitive: false,
    mediaIds: [],
  },
  media: [],
  failed: false,
  error: '',
  createdAt: new Date().toISOString(),
  ...over,
});

describe('scheduled posts (#28)', () => {
  it('schedules a post from the composer at the chosen time', async () => {
    let sent: Record<string, unknown> | null = null;
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'POST /scheduled_statuses': (body) => {
        sent = body as Record<string, unknown>;
        return { status: 201, body: scheduled({ scheduledAt: String(sent.scheduledAt) }) };
      },
    });
    renderApp('/');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'New post' }), 'Buongiorno');
    await user.click(screen.getByRole('button', { name: 'Publish later' }));

    // No time yet: it says so instead of sending.
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText('Choose when to publish it.')).toBeInTheDocument();
    expect(sent).toBeNull();

    const when = new Date(Date.now() + 3 * 3600_000);
    when.setSeconds(0, 0);
    const input = screen.getByLabelText('Publish on');
    await user.clear(input);
    await user.type(input, localInput(when));
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toMatchObject({ content: 'Buongiorno', scheduledAt: when.toISOString() });
    expect(await screen.findByText(/Scheduled for/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See scheduled posts' })).toHaveAttribute(
      'href',
      '/scheduled',
    );
  });

  it('lists them, flags the failed ones, and cancels on request', async () => {
    const next = scheduled({ params: { ...scheduled().params, content: 'Il prossimo' } });
    const failed = scheduled({
      params: { ...scheduled().params, content: 'Non uscito' },
      failed: true,
      error: 'interrupted',
    });
    let list = [next, failed];
    mockApi({
      'GET /me': { body: aliceUser },
      'GET /instance': instance(),
      'GET /scheduled_statuses': () => ({ body: list }),
      [`DELETE /scheduled_statuses/${next.id}`]: () => {
        list = list.filter((p) => p.id !== next.id);
        return { body: { status: 'ok' } };
      },
    });
    renderApp('/scheduled');
    expect(await screen.findByText('Il prossimo')).toBeInTheDocument();
    expect(screen.getByText(/publishing was interrupted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again at a new time' })).toBeInTheDocument();
    // The menu shows that one post is waiting for its author.
    expect((await screen.findAllByText('1 scheduled post not published')).length).toBeGreaterThan(
      0,
    );

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryByText('Il prossimo')).not.toBeInTheDocument());
    expect(screen.getByText('Non uscito')).toBeInTheDocument();
  });
});
