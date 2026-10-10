import type { Account } from '@disbigle/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { useFollowedTags, useRelationships } from '../api/socialQueries.ts';
import { AccountRow } from '../components/AccountList.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { FollowButton } from '../components/FollowButton.tsx';
import { GlobeIcon, SearchIcon } from '../components/icons.tsx';
import { Alert, Button, LoadingState, Spinner } from '../components/ui.tsx';

export const SEARCH_DEBOUNCE_MS = 300;

/** `@user@domain`, `user@domain` or a profile URL: something only another server can answer. */
export function looksRemote(query: string): boolean {
  const q = query.trim();
  return /^@?[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(q) || /^https?:\/\/\S+\.\S+/.test(q);
}

/** The handle without its leading `@`, lower-cased, for comparing with `acct`. */
const bareHandle = (q: string) => q.trim().replace(/^@/, '').toLowerCase();

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { q = '' } = useSearch({ from: '/search' });
  const [text, setText] = useState(q);
  const inputId = useId();

  // Keep the box in step with the URL (e.g. a new search from the top bar).
  useEffect(() => setText((current) => (current.trim() === q ? current : q)), [q]);

  // Update the URL shortly after typing stops, so results follow without a submit.
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(
      () =>
        void navigate({ to: '/search', search: { q: text.trim() || undefined }, replace: true }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [text, q, navigate]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void navigate({ to: '/search', search: { q: text.trim() || undefined }, replace: true });
  };

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('search.title')}
        description={t('search.description')}
        icon={SearchIcon}
      />
      <search>
        <form onSubmit={onSubmit} className="relative">
          <label htmlFor={inputId} className="sr-only">
            {t('search.label')}
          </label>
          <SearchIcon
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-muted"
          />
          <input
            id={inputId}
            type="search"
            // biome-ignore lint/a11y/noAutofocus: searching is the only task on this page
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('search.placeholder')}
            className="input-base rounded-full py-3 pl-10 text-base"
          />
        </form>
      </search>
      {q ? <SearchResults key={q} query={q} /> : <SearchTips />}
    </div>
  );
}

function SearchTips() {
  const { t } = useTranslation();
  const tags = useFollowedTags();
  return (
    <>
      {tags.data && tags.data.length > 0 && (
        <FeedSection className="p-5">
          <h2 className="text-sm font-semibold">{t('tags.followedTitle')}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {tags.data.map((name) => (
              <li key={name}>
                <Link
                  to="/tags/$tag"
                  params={{ tag: name }}
                  className="inline-block rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent hover:underline focus-ring"
                >
                  #{name}
                </Link>
              </li>
            ))}
          </ul>
        </FeedSection>
      )}
      <FeedSection className="space-y-3 p-5 text-sm text-fg-muted">
        <p>{t('search.tips.names')}</p>
        <p>
          {t('search.tips.remote')}{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-fg">
            @someone@mastodon.social
          </code>
        </p>
        <p>{t('search.tips.url')}</p>
      </FeedSection>
    </>
  );
}

function SearchResults({ query }: { query: string }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const results = useQuery({
    queryKey: ['search', 'accounts', query],
    queryFn: () => social.searchAccounts(query),
    staleTime: 30_000,
  });
  const remote = looksRemote(query);
  const exact = results.data?.some(
    (account) => account.acct.toLowerCase() === bareHandle(query) || account.url === query.trim(),
  );

  return (
    <div className="space-y-4">
      {remote && !exact && (user ? <RemoteLookup query={query} /> : <SignInToLookUp />)}

      <FeedSection>
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">
          {t('search.people')}
        </h2>
        {results.isPending ? (
          <LoadingState label={t('search.searching')} />
        ) : results.isError ? (
          <Alert className="m-4">{errorMessage(results.error)}</Alert>
        ) : results.data.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-muted">
            {remote ? t('search.noLocalMatchRemote') : t('search.noResults', { query })}
          </p>
        ) : (
          <AccountResults accounts={results.data} />
        )}
      </FeedSection>
    </div>
  );
}

function AccountResults({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation();
  useRelationships(accounts.map((account) => account.id));
  return (
    <ul aria-label={t('search.people')} className="p-2">
      {accounts.map((account) => (
        <li key={account.id}>
          <AccountRow
            account={account}
            actions={<FollowButton account={account} compact fetch={false} />}
          />
        </li>
      ))}
    </ul>
  );
}

function SignInToLookUp() {
  const { t } = useTranslation();
  return (
    <FeedSection className="p-5 text-sm">
      <p className="text-fg-muted">{t('search.signInToLookUp')}</p>
      <Link to="/login" className="mt-2 inline-block font-medium text-accent hover:underline">
        {t('nav.signIn')}
      </Link>
    </FeedSection>
  );
}

/** Asks this server to fetch an account from its home server (ActivityPub or diaspora*). */
function RemoteLookup({ query }: { query: string }) {
  const { t } = useTranslation();
  const lookup = useMutation({ mutationFn: () => social.resolveAccount(query.trim()) });

  return (
    <FeedSection className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <GlobeIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-all">
            {t('search.remoteTitle', { query: query.trim() })}
          </p>
          <p className="text-sm text-fg-muted">{t('search.remoteHint')}</p>
        </div>
        {!lookup.isSuccess && (
          <Button onClick={() => lookup.mutate()} loading={lookup.isPending}>
            {t('search.lookUp')}
          </Button>
        )}
      </div>

      <div aria-live="polite" className="mt-3 empty:hidden">
        {lookup.isPending && (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner />
            {t('search.lookingUp', { query: query.trim() })}
          </p>
        )}
        {lookup.isSuccess && lookup.data === null && (
          <div className="space-y-2">
            <p className="text-sm">{t('search.notFoundRemote', { query: query.trim() })}</p>
            <Button variant="secondary" onClick={() => lookup.mutate()}>
              {t('search.tryAgain')}
            </Button>
          </div>
        )}
        {lookup.isSuccess && lookup.data && (
          <div className="rounded-xl border border-border">
            <p className="sr-only">{t('search.found')}</p>
            <AccountRow
              account={lookup.data}
              actions={<FollowButton account={lookup.data} compact />}
            />
          </div>
        )}
      </div>
      {lookup.error && <Alert className="mt-3">{errorMessage(lookup.error)}</Alert>}
    </FeedSection>
  );
}
