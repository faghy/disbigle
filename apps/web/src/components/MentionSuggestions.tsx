import type { Account } from '@disbigle/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type RefObject, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { social } from '../api/social.ts';
import { Avatar } from './Avatar.tsx';
import { cx } from './ui.tsx';

const MAX_SUGGESTIONS = 6;

/** The `@name` being typed right before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[\s(])@([\p{L}\p{N}_.-]*(?:@[\p{L}\p{N}_.-]*)?)$/u.exec(text.slice(0, caret));
  if (!match?.[1]) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Suggests people while an `@name` is typed in a textarea (the people you follow first) and
 * replaces it with their full handle when one is picked.
 */
export function useMentionSuggestions({
  textarea,
  content,
  setContent,
}: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  content: string;
  setContent: (content: string) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  // The highlighted suggestion, back to the first one whenever the query changes.
  const [highlight, setHighlight] = useState({ query: '', index: 0 });
  const [dismissed, setDismissed] = useState<number | null>(null);

  const mention = caret === null ? null : mentionAt(content, caret);
  const query = useDebounced(mention?.query ?? '', 200);
  const results = useQuery({
    queryKey: ['search', 'accounts', query],
    queryFn: () => social.searchAccounts(query),
    enabled: query.length > 0,
    staleTime: 30_000,
  });
  const accounts = (results.data ?? []).slice(0, MAX_SUGGESTIONS);
  const open =
    mention !== null && mention.start !== dismissed && query.length > 0 && accounts.length > 0;

  const active = highlight.query === query ? highlight.index : 0;
  const setActive = (index: number) => setHighlight({ query, index });

  /** Called on every change and selection of the textarea. */
  const trackCaret = () => {
    const element = textarea.current;
    setCaret(element && element === document.activeElement ? element.selectionStart : null);
  };

  const pick = (account: Account) => {
    if (!mention || caret === null) return;
    const inserted = `@${account.acct} `;
    const next =
      content.slice(0, mention.start) + inserted + content.slice(caret).replace(/^ /, '');
    const position = mention.start + inserted.length;
    setContent(next);
    setCaret(position);
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  /** Arrow keys, Enter/Tab and Escape while the list is open; true when the key was used. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + accounts.length) % accounts.length);
    } else if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
      const account = accounts[active];
      if (account) pick(account);
    } else if (event.key === 'Escape') {
      setDismissed(mention?.start ?? null);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  };

  const textareaProps = {
    onSelect: trackCaret,
    onBlur: () => setCaret(null),
    'aria-autocomplete': 'list' as const,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open ? `${listId}-${active}` : undefined,
  };

  const list = open ? (
    <div
      id={listId}
      role="listbox"
      aria-label={t('composer.mentionSuggestions')}
      className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
    >
      {accounts.map((account, index) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard picks from the textarea
        <div
          key={account.id}
          id={`${listId}-${index}`}
          role="option"
          tabIndex={-1}
          aria-selected={index === active}
          // Keep the focus in the textarea while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(account)}
          onMouseEnter={() => setActive(index)}
          className={cx(
            'flex cursor-pointer items-center gap-3 px-3 py-2',
            index === active ? 'bg-accent-soft' : 'hover:bg-surface-muted',
          )}
        >
          <Avatar account={account} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {account.displayName || account.username}
            </span>
            <span className="block truncate text-xs text-fg-muted">@{account.acct}</span>
          </span>
        </div>
      ))}
    </div>
  ) : null;

  return { textareaProps, trackCaret, onKeyDown, list };
}
