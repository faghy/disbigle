import type { Account, Status } from '@disbigle/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { type Conversation, PAGE_SIZE, social } from '../api/social.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { CloseIcon, MailIcon } from '../components/icons.tsx';
import { displayName, statusPath } from '../components/StatusCard.tsx';
import { Alert, Button, cx, LoadingState, Spinner } from '../components/ui.tsx';
import { relativeTime } from '../lib/time.ts';

export const conversationsKey = ['conversations'] as const;

function excerpt(status: Status): string {
  if (status.summary) return status.summary;
  const text = new DOMParser().parseFromString(status.content, 'text/html').body.textContent ?? '';
  return text.trim();
}

export function MessagesPage() {
  const { t } = useTranslation();
  const [composing, setComposing] = useState(false);
  const query = useInfiniteQuery({
    queryKey: conversationsKey,
    queryFn: ({ pageParam }) => social.conversations({ maxId: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.lastStatus.id,
  });
  const conversations = query.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('messages.title')}
        description={t('messages.description')}
        icon={MailIcon}
        actions={
          !composing && <Button onClick={() => setComposing(true)}>{t('messages.new')}</Button>
        }
      />
      {composing && <NewMessage onClose={() => setComposing(false)} />}
      <FeedSection>
        {query.isPending ? (
          <LoadingState label={t('common.loading')} />
        ) : query.isError && conversations.length === 0 ? (
          <Alert className="m-4">{errorMessage(query.error)}</Alert>
        ) : conversations.length === 0 ? (
          <p className="px-4 py-16 text-center text-fg-muted">{t('messages.empty')}</p>
        ) : (
          <ul aria-label={t('messages.title')}>
            {conversations.map((conversation) => (
              <li key={conversation.id} className="border-b border-border last:border-b-0">
                <ConversationRow conversation={conversation} />
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center p-4">
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('timeline.loadMore')}
            </Button>
          </div>
        )}
      </FeedSection>
    </div>
  );
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const { t, i18n } = useTranslation();
  const me = useCurrentUser();
  const { lastStatus, accounts } = conversation;
  const people = accounts.length > 0 ? accounts : [lastStatus.account];
  const names = people.map(displayName).join(', ');
  const fromMe = lastStatus.account.id === me?.account.id;
  const text = excerpt(lastStatus) || t('notifications.mediaPost');

  return (
    <Link
      {...statusPath(lastStatus)}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted focus-ring sm:px-5"
    >
      <span className="relative flex shrink-0">
        {people.slice(0, 3).map((account, index) => (
          <Avatar
            key={account.id}
            account={account}
            size="md"
            className={cx('ring-2 ring-surface', index > 0 && '-ml-5')}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{names}</span>
          <time dateTime={lastStatus.createdAt} className="ml-auto shrink-0 text-xs text-fg-muted">
            {relativeTime(lastStatus.createdAt, i18n.language)}
          </time>
        </span>
        <span className="block truncate text-sm text-fg-muted">
          {fromMe ? `${t('messages.you')}: ` : ''}
          {text}
        </span>
      </span>
    </Link>
  );
}

/** Direct message composer with a recipient picker that adds @mentions to the text. */
function NewMessage({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const editContent = useRef<((edit: (content: string) => string) => void) | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [recipients, setRecipients] = useState<Account[]>([]);

  const add = (account: Account) => {
    if (recipients.some((r) => r.id === account.id)) return;
    setRecipients((list) => [...list, account]);
    // New recipients go before the other mentions at the start of the message.
    editContent.current?.((content) => {
      const lead = content.match(/^(\s*@\S+\s+)*/)?.[0] ?? '';
      return `${lead}@${account.acct} ${content.slice(lead.length)}`;
    });
    textarea.current?.focus();
  };
  const remove = (account: Account) => {
    setRecipients((list) => list.filter((r) => r.id !== account.id));
    const escaped = account.acct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    editContent.current?.((content) =>
      content.replace(new RegExp(`(^|\\s)@${escaped}(?=\\s|$)\\s?`, 'gi'), '$1'),
    );
  };

  return (
    <section aria-label={t('messages.new')} className="space-y-2">
      <Composer
        initialAudience={{ visibility: 'direct', aspectIds: [] }}
        editContentRef={editContent}
        textareaRef={textarea}
        header={<RecipientPicker recipients={recipients} onAdd={add} onRemove={remove} />}
        onCancel={onClose}
        onPosted={(status) => {
          void queryClient.invalidateQueries({ queryKey: conversationsKey });
          onClose();
          void navigate(statusPath(status));
        }}
      />
    </section>
  );
}

function RecipientPicker({
  recipients,
  onAdd,
  onRemove,
}: {
  recipients: Account[];
  onAdd: (account: Account) => void;
  onRemove: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const me = useCurrentUser();
  // Search shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery({
    queryKey: ['search', 'accounts', query],
    queryFn: () => social.searchAccounts(query),
    enabled: query.length > 0,
    staleTime: 30_000,
  });
  const options = (results.data ?? []).filter(
    (account) => account.id !== me?.account.id && !recipients.some((r) => r.id === account.id),
  );

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('messages.to')}
      </label>
      {recipients.length > 0 && (
        <ul aria-label={t('messages.recipients')} className="flex flex-wrap gap-1.5">
          {recipients.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => onRemove(account)}
                aria-label={t('messages.removeRecipient', { acct: account.acct })}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 focus-ring"
              >
                @{account.acct}
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        type="search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        placeholder={t('messages.searchPlaceholder')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter picks the first match instead of sending the message.
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = options[0];
          if (first) {
            onAdd(first);
            setText('');
            setQuery('');
          }
        }}
        className="input-base"
      />
      {query && (
        <div aria-live="polite">
          {results.isFetching && !results.data ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner />
              {t('search.searching')}
            </p>
          ) : options.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('messages.noMatches')}</p>
          ) : (
            <ul
              aria-label={t('messages.suggestions')}
              className="max-h-56 overflow-y-auto rounded-xl border border-border"
            >
              {options.slice(0, 8).map((account) => (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(account);
                      setText('');
                      setQuery('');
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted focus-ring"
                  >
                    <Avatar account={account} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {displayName(account)}
                      </span>
                      <span className="block truncate text-xs text-fg-muted">@{account.acct}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
