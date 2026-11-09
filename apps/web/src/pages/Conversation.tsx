import type { Account, ConversationDetail, Status } from '@disbigle/shared';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { useCreateStatus } from '../api/mutations.ts';
import { useCurrentUser } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FeedSection } from '../components/FeedSection.tsx';
import { ChevronLeftIcon } from '../components/icons.tsx';
import {
  displayName,
  MediaGrid,
  profilePath,
  StatusContent,
  statusPath,
} from '../components/StatusCard.tsx';
import { useStream } from '../components/StreamingProvider.tsx';
import { Alert, Button, cx, LoadingState } from '../components/ui.tsx';
import { presenceColor } from '../lib/presence.ts';
import { relativeTime } from '../lib/time.ts';

const PAGE = 30;
/** How often "typing" is sent while writing, and how long it shows on the other side. */
const TYPING_EVERY = 3000;
const TYPING_SHOWN = 6000;

export const conversationKey = (id: string) => ['conversation', id] as const;

/**
 * The @mentions at the start of a message only address it (every message of a conversation
 * names its participants): the chat leaves them out.
 */
export function withoutLeadingMentions(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const first = doc.body.firstElementChild;
  if (!first) return html;
  let removed = false;
  while (first.firstChild) {
    const node = first.firstChild;
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      node.remove();
      continue;
    }
    const element = node as Element;
    const isMention =
      node.nodeType === Node.ELEMENT_NODE &&
      (element.matches('a.mention:not(.hashtag)') ||
        (element.matches('span.h-card') && element.querySelector('a.mention')));
    if (!isMention) break;
    node.remove();
    removed = true;
  }
  if (!removed) return html;
  if (first.firstChild?.nodeType === Node.TEXT_NODE)
    first.firstChild.textContent = (first.firstChild.textContent ?? '').replace(/^\s+/, '');
  if (!first.textContent?.trim() && !first.querySelector('img')) first.remove();
  return doc.body.innerHTML;
}

/** A private conversation shown as a chat: bubbles, newest at the bottom, live. */
export function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams({ from: '/messages/$conversationId' });
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const [typing, setTyping] = useState<Record<string, { account: Account; until: number }>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const key = conversationKey(conversationId);

  // Who is around, for those who share it: asked again every half minute.
  const presence = useQuery({
    queryKey: [...key, 'presence'],
    queryFn: () => social.conversationPresence(conversationId),
    refetchInterval: 30_000,
  });
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      social.conversation(conversationId, { maxId: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.messages.length < PAGE ? undefined : lastPage.messages.at(-1)?.id,
  });
  const first = query.data?.pages[0];
  // Pages are newest first: the chat reads oldest first.
  const messages = (query.data?.pages.flatMap((page) => page.messages) ?? []).slice().reverse();
  const newestId = messages.at(-1)?.id;

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      await social.readConversation(conversationId);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch {
      // Not important: it is tried again with the next message.
    }
  }, [conversationId, queryClient]);

  // Read as soon as it opens, at every new message, and when the tab comes back.
  useEffect(() => {
    if (newestId) void markRead();
  }, [newestId, markRead]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void markRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  // New messages come in through the live stream; the newest page is fetched again.
  useStream('user', (event) => {
    if (event.event === 'update' && event.payload.visibility === 'direct') {
      void queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
      setTyping((all) => {
        const { [event.payload.account.id]: _gone, ...rest } = all;
        return rest;
      });
    } else if (
      event.event === 'conversation.read' &&
      event.payload.conversationId === conversationId
    ) {
      const { accountId, lastReadId } = event.payload;
      if (accountId === me?.account.id) return;
      queryClient.setQueryData<InfiniteData<ConversationDetail>>(key, (data) => {
        if (!data?.pages[0]) return data;
        const [head, ...rest] = data.pages;
        const seen = [
          ...head.seen.filter((s) => s.accountId !== accountId),
          { accountId, lastReadId },
        ];
        return { ...data, pages: [{ ...head, seen }, ...rest] };
      });
    } else if (
      event.event === 'conversation.typing' &&
      event.payload.conversationId === conversationId
    ) {
      const { account } = event.payload;
      setTyping((all) => ({ ...all, [account.id]: { account, until: Date.now() + TYPING_SHOWN } }));
    }
  });

  // "Typing" fades out by itself.
  useEffect(() => {
    const ids = Object.keys(typing);
    if (ids.length === 0) return;
    const timer = setInterval(() => {
      setTyping((all) => {
        const now = Date.now();
        const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => v.until > now));
        return Object.keys(kept).length === Object.keys(all).length ? all : kept;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  // Stay at the bottom as messages arrive; older pages keep their place.
  const lastNewest = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    if (lastNewest.current !== newestId) bottom.current?.scrollIntoView({ block: 'end' });
    lastNewest.current = newestId;
  }, [messages.length, newestId]);

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError && !first) return <Alert>{errorMessage(query.error)}</Alert>;
  if (!first) return null;

  const people = first.accounts;
  const names = people.map(displayName).join(', ') || t('messages.onlyYou');
  const myLast = [...messages].reverse().find((m) => m.account.id === me?.account.id);
  const seenBy = myLast
    ? first.seen
        .filter((s) => s.lastReadId >= myLast.id)
        .map((s) => people.find((p) => p.id === s.accountId))
        .filter((a): a is Account => !!a)
    : [];
  const typingNow = Object.values(typing).map((v) => displayName(v.account));

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <header className="sticky top-16 z-10 mb-3 flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-3 py-2 backdrop-blur">
        <Link
          to="/messages"
          className="rounded-full p-1.5 text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring"
          aria-label={t('messages.back')}
        >
          <ChevronLeftIcon size={20} />
        </Link>
        <span className="flex shrink-0">
          {people.slice(0, 3).map((account, index) => {
            const state = presence.data?.[account.id];
            return (
              <span key={account.id} className={cx('relative flex', index > 0 && '-ml-3')}>
                <Avatar account={account} size="sm" className="ring-2 ring-surface" />
                {state && (
                  <span
                    className={cx(
                      'absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-surface',
                      presenceColor[state],
                    )}
                  />
                )}
              </span>
            );
          })}
        </span>
        <h1 className="min-w-0 flex-1 truncate font-semibold">
          {people.length === 1 && people[0] ? (
            <Link {...profilePath(people[0])} className="hover:underline focus-ring">
              {names}
            </Link>
          ) : (
            names
          )}
          {people.map((account) => {
            const state = presence.data?.[account.id];
            if (!state) return null;
            return (
              <span key={account.id} className="block truncate text-xs font-normal text-fg-muted">
                {people.length > 1 ? `${displayName(account)}: ` : ''}
                {t(`messages.presence.state.${state}`)}
              </span>
            );
          })}
        </h1>
      </header>

      <FeedSection>
        <div className="flex flex-col gap-1 px-3 py-4 sm:px-4" aria-live="polite">
          {query.hasNextPage && (
            <div className="mb-3 flex justify-center">
              <Button
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t('messages.older')}
              </Button>
            </div>
          )}
          {messages.map((message, index) => (
            <Bubble
              key={message.id}
              status={message}
              mine={message.account.id === me?.account.id}
              showAuthor={
                people.length > 1 && messages[index - 1]?.account.id !== message.account.id
              }
            />
          ))}
          {seenBy.length > 0 && (
            <p className="mt-1 text-right text-xs text-fg-muted">
              {people.length === 1
                ? t('messages.seen')
                : t('messages.seenBy', { names: seenBy.map(displayName).join(', ') })}
            </p>
          )}
          <p className="min-h-5 text-sm text-fg-muted italic">
            {typingNow.length > 0 && t('messages.typing', { names: typingNow.join(', ') })}
          </p>
          <div ref={bottom} />
        </div>
        <ChatInput conversationId={conversationId} people={people} replyTo={messages.at(-1)} />
      </FeedSection>
    </div>
  );
}

function Bubble({
  status,
  mine,
  showAuthor,
}: {
  status: Status;
  mine: boolean;
  showAuthor: boolean;
}) {
  const { i18n } = useTranslation();
  const html = withoutLeadingMentions(status.content);
  return (
    <div className={cx('flex max-w-[85%] flex-col', mine ? 'self-end items-end' : 'self-start')}>
      {showAuthor && !mine && (
        <span className="mt-2 mb-0.5 px-3 text-xs font-medium text-fg-muted">
          {displayName(status.account)}
        </span>
      )}
      <div
        className={cx(
          'rounded-2xl px-3.5 py-2',
          mine ? 'rounded-br-md bg-accent text-accent-fg' : 'rounded-bl-md bg-surface-muted',
        )}
      >
        {status.summary && <p className="mb-1 font-semibold">{status.summary}</p>}
        <StatusContent
          html={html}
          mentions={status.mentions}
          className={cx('chat-bubble', mine && 'chat-mine')}
        />
        {status.media.length > 0 && (
          <div className="mt-2 min-w-48">
            <MediaGrid media={status.media} sensitive={status.sensitive} />
          </div>
        )}
      </div>
      <Link
        {...statusPath(status)}
        className="px-2 pt-0.5 text-[11px] text-fg-muted hover:underline focus-ring"
      >
        <time
          dateTime={status.createdAt}
          title={new Date(status.createdAt).toLocaleString(i18n.language)}
        >
          {relativeTime(status.createdAt, i18n.language)}
        </time>
      </Link>
    </div>
  );
}

/** Writes in the conversation: Enter sends, Shift+Enter starts a new line. */
function ChatInput({
  conversationId,
  people,
  replyTo,
}: {
  conversationId: string;
  people: Account[];
  replyTo: Status | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const create = useCreateStatus();
  const inputId = useId();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // A height the person chose by dragging the corner: the box never shrinks below it.
  const chosenHeight = useRef(0);
  const autoHeight = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: grows with the text
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    const wanted = Math.min(element.scrollHeight + 2, window.innerHeight * 0.5);
    const height = Math.max(wanted, chosenHeight.current);
    element.style.height = `${height}px`;
    autoHeight.current = height;
  }, [text]);
  const rememberResize = () => {
    const element = field.current;
    if (element && Math.abs(element.offsetHeight - autoHeight.current) > 2)
      chosenHeight.current = element.offsetHeight;
  };
  const lastTyping = useRef(0);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const body = text.trim();
    if (!body || create.isPending) return;
    // Every message names the participants: they are its recipients.
    const to = people.map((p) => `@${p.acct}`).join(' ');
    create.mutate(
      {
        content: to ? `${to} ${body}` : body,
        visibility: 'direct',
        aspectIds: [],
        summary: '',
        sensitive: false,
        mediaIds: [],
        ...(replyTo ? { inReplyToId: replyTo.id } : {}),
      },
      {
        onSuccess: () => {
          setText('');
          void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) });
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        },
      },
    );
  };

  const onChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > TYPING_EVERY) {
      lastTyping.current = now;
      void social.typing(conversationId).catch(() => {});
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
  };

  return (
    <form onSubmit={send} className="border-t border-border p-3">
      {create.isError && <Alert className="mb-2">{errorMessage(create.error)}</Alert>}
      <div className="flex items-end gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t('messages.write')}
        </label>
        <textarea
          id={inputId}
          ref={field}
          rows={2}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPointerUp={rememberResize}
          placeholder={t('messages.write')}
          className="max-h-[80vh] min-h-12 flex-1 resize-y rounded-2xl border border-border bg-surface px-3.5 py-2 text-base focus-ring"
        />
        <Button type="submit" loading={create.isPending} disabled={!text.trim()}>
          {t('messages.send')}
        </Button>
      </div>
    </form>
  );
}
