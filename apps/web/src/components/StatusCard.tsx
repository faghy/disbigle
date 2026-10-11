import type { Account, MediaAttachment, Mention, Status } from '@disbigle/shared';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shownStatus } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { type ToggleKind, useDeleteStatus, useToggleStatus } from '../api/mutations.ts';
import { useCurrentUser } from '../api/queries.ts';
import { useAspects } from '../api/socialQueries.ts';
import { useDismiss } from '../lib/dismiss.ts';
import { fullDateTime, relativeTime } from '../lib/time.ts';
import { canReshare, visibilityIcons } from '../lib/visibility.tsx';
import { Avatar } from './Avatar.tsx';
import { Composer } from './Composer.tsx';
import { ConfirmDialog } from './Dialog.tsx';
import { EditStatusForm } from './EditStatusForm.tsx';
import {
  BookmarkIcon,
  HeartIcon,
  MoreIcon,
  ReplyIcon,
  ReshareIcon,
  WarningIcon,
} from './icons.tsx';
import { Lightbox } from './Lightbox.tsx';
import { PollView } from './PollView.tsx';
import { ReportDialog } from './ReportDialog.tsx';
import { Alert, cx } from './ui.tsx';

/** Path of a post page inside the app. */
export const statusPath = (status: Status) => ({
  to: '/@{$username}/$statusId' as const,
  params: { username: status.account.acct, statusId: status.id },
});

/** Path of a profile page inside the app; remote accounts use their full `user@domain`. */
export const profilePath = (account: Pick<Account, 'acct'>) => ({
  to: '/@{$username}' as const,
  params: { username: account.acct },
});

/** Links to a profile inside the app, for local and remote accounts alike. */
export function AccountLink({
  account,
  className,
  children,
}: {
  account: Account;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link {...profilePath(account)} className={className}>
      {children}
    </Link>
  );
}

export const displayName = (account: Account) => account.displayName || account.username;

const INTERNAL_PATH = /^\/(@[A-Za-z0-9_]{1,30}(\/[0-9a-f-]{36})?|tags\/[^/?#]+)\/?$/;

/** Normalises a URL for comparison (no trailing slash, no fragment). */
const sameUrl = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
};

/**
 * Post HTML, sanitised by the server. Links to profiles, posts and tags of this server
 * open inside the app, and so do mentions of remote people (their profile page here).
 */
export function StatusContent({
  html,
  mentions = [],
  className,
}: {
  html: string;
  mentions?: Mention[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      const mention = anchor.classList.contains('mention')
        ? mentionsRef.current.find((m) => m.url && sameUrl(m.url, url.href))
        : undefined;
      if (mention) {
        event.preventDefault();
        router.history.push(`/@${mention.acct}`);
        return;
      }
      if (url.origin !== window.location.origin || !INTERNAL_PATH.test(url.pathname)) return;
      event.preventDefault();
      router.history.push(url.pathname);
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [router]);

  return (
    <div
      ref={ref}
      className={cx('status-content break-words', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: post HTML is sanitised by the server
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function VisibilityBadge({ status, isAuthor }: { status: Status; isAuthor: boolean }) {
  const { t } = useTranslation();
  const aspects = useAspects();
  const Icon = visibilityIcons[status.visibility];
  const label = t(`visibility.${status.visibility}.label`);
  let detail: string | null = null;
  if (status.visibility === 'limited') {
    const names =
      isAuthor && status.aspectIds && aspects.data
        ? aspects.data.filter((a) => status.aspectIds?.includes(a.id)).map((a) => a.name)
        : [];
    detail = names.length > 0 ? names.join(', ') : t('status.sharedWithAspects');
  }
  return (
    <span
      className={cx(
        'inline-flex min-w-0 items-center gap-1 text-xs',
        status.visibility === 'limited' ? 'text-accent' : 'text-fg-muted',
      )}
      title={detail ?? label}
    >
      <Icon size={14} />
      {detail ? (
        <span className="truncate">{detail}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

function MediaGrid({ media, sensitive }: { media: MediaAttachment[]; sensitive: boolean }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(!sensitive);
  const [viewing, setViewing] = useState<number | null>(null);
  const images = media.filter((m) => m.type === 'image');
  const others = media.filter((m) => m.type !== 'image');

  return (
    <div className="relative mt-3">
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-surface-muted/95 text-sm font-medium backdrop-blur-xl focus-ring"
        >
          <WarningIcon />
          <span>{t('status.media.sensitive')}</span>
          <span className="text-xs text-fg-muted">{t('status.media.reveal')}</span>
        </button>
      )}
      {images.length > 0 && (
        <div
          className={cx(
            'grid gap-1 overflow-hidden rounded-xl',
            images.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
          )}
          aria-hidden={!revealed || undefined}
        >
          {images.map((item, index) => (
            <button
              key={item.id}
              type="button"
              tabIndex={revealed ? 0 : -1}
              className={cx(
                'relative block overflow-hidden bg-surface-muted focus-ring',
                images.length === 1 ? 'max-h-[28rem]' : 'aspect-video',
                images.length === 3 && index === 0 && 'row-span-2 aspect-auto',
              )}
              onClick={() => setViewing(index)}
              aria-label={
                item.description
                  ? t('status.media.openWithAlt', { alt: item.description })
                  : t('status.media.open')
              }
            >
              <img
                src={item.previewUrl ?? item.url}
                alt={item.description}
                loading="lazy"
                width={item.width ?? undefined}
                height={item.height ?? undefined}
                className="size-full object-cover"
              />
              {item.description && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  ALT
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {others.map((item) =>
        item.type === 'video' ? (
          // biome-ignore lint/a11y/useMediaCaption: user uploads have no caption tracks yet
          <video
            key={item.id}
            src={item.url}
            controls
            preload="metadata"
            aria-label={item.description || undefined}
            className="mt-1 max-h-[28rem] w-full rounded-xl bg-black"
          />
        ) : item.type === 'audio' ? (
          // biome-ignore lint/a11y/useMediaCaption: user uploads have no caption tracks yet
          <audio
            key={item.id}
            src={item.url}
            controls
            preload="metadata"
            aria-label={item.description || undefined}
            className="mt-1 w-full"
          />
        ) : (
          <a key={item.id} href={item.url} className="mt-1 block text-sm text-accent underline">
            {item.description || item.url}
          </a>
        ),
      )}
      {viewing !== null && (
        <Lightbox media={images} startIndex={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function ActionButton({
  label,
  count,
  active,
  activeClass,
  disabled,
  onClick,
  children,
  pressed,
}: {
  label: string;
  count?: number;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 text-sm text-fg-muted transition-colors focus-ring',
        'hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        active && activeClass,
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

function MoreMenu({
  status,
  isAuthor,
  signedIn,
  onEdit,
}: {
  status: Status;
  isAuthor: boolean;
  signedIn: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const router = useRouter();
  const remove = useDeleteStatus();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const link = status.url ?? `${window.location.origin}/@${status.account.acct}/${status.id}`;
  const itemClass =
    'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted focus-ring';

  return (
    <div ref={containerRef} className="relative ml-auto">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('status.more')}
        title={t('status.more')}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring"
      >
        <MoreIcon />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 bottom-full z-20 mb-1 w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
      >
        <button
          type="button"
          className={itemClass}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('status.linkCopied') : t('status.copyLink')}
        </button>
        {!status.account.local && status.url && (
          <a href={status.url} target="_blank" rel="noopener noreferrer" className={itemClass}>
            {t('status.openOriginal')}
          </a>
        )}
        {isAuthor && status.account.local && (
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            {t('status.edit')}
          </button>
        )}
        {isAuthor && (
          <button
            type="button"
            className={cx(itemClass, 'text-danger')}
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            {t('status.delete')}
          </button>
        )}
        {signedIn && !isAuthor && (
          <button
            type="button"
            className={cx(itemClass, 'text-danger')}
            onClick={() => {
              setOpen(false);
              setReporting(true);
            }}
          >
            {t('status.report', { acct: status.account.acct })}
          </button>
        )}
      </div>
      {reporting && (
        <ReportDialog
          account={status.account}
          status={status}
          onClose={() => {
            setReporting(false);
            buttonRef.current?.focus();
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={t('status.deleteTitle')}
          description={
            remove.error ? (
              <span className="text-danger">{errorMessage(remove.error)}</span>
            ) : (
              t('status.deleteDescription')
            )
          }
          confirmLabel={t('status.delete')}
          pending={remove.isPending}
          onCancel={() => {
            setConfirming(false);
            remove.reset();
          }}
          onConfirm={() =>
            remove.mutate(status, {
              onSuccess: () => {
                setConfirming(false);
                // Leave the page of a post that no longer exists.
                if (router.state.location.pathname.endsWith(`/${status.id}`))
                  router.history.push('/');
              },
            })
          }
        />
      )}
    </div>
  );
}

export interface StatusCardProps {
  status: Status;
  /** The post a thread page is about: larger text and the full date. */
  highlighted?: boolean;
  /** Overrides the reply button (the post page focuses its own composer). */
  onReply?: () => void;
  position?: number;
}

export function StatusCard({
  status: item,
  highlighted = false,
  onReply,
  position,
}: StatusCardProps) {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const status = shownStatus(item);
  const { account } = status;
  const isAuthor = user?.account.id === account.id;
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const toggle = useToggleStatus();
  const contentId = useId();
  const headingId = useId();
  const hasWarning = status.summary.length > 0;
  const signedIn = Boolean(user);

  const act = (kind: ToggleKind, value: boolean) => toggle.mutate({ status, kind, value });

  return (
    <article
      aria-labelledby={headingId}
      aria-posinset={position}
      aria-setsize={position !== undefined ? -1 : undefined}
      className={cx('border-b border-border px-4 py-4 sm:px-5', highlighted && 'bg-accent-soft/30')}
    >
      {item.reblog && (
        <p className="mb-2 flex items-center gap-2 pl-6 text-sm text-fg-muted">
          <ReshareIcon size={16} />
          <AccountLink account={item.account} className="truncate font-medium hover:underline">
            {t('status.reshared', { name: displayName(item.account) })}
          </AccountLink>
        </p>
      )}

      <div className="flex gap-3">
        <AccountLink account={account} className="shrink-0 rounded-full focus-ring">
          <Avatar account={account} size="md" />
          <span className="sr-only">{displayName(account)}</span>
        </AccountLink>

        <div className="min-w-0 flex-1">
          <header className="flex items-start gap-2">
            <h3 id={headingId} className="min-w-0 flex-1 leading-tight">
              <AccountLink account={account} className="group block min-w-0 rounded focus-ring">
                <span className="block truncate font-semibold group-hover:underline">
                  {displayName(account)}
                </span>
                <span className="block truncate text-sm text-fg-muted">@{account.acct}</span>
              </AccountLink>
            </h3>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <Link
                {...statusPath(status)}
                className="rounded text-sm text-fg-muted hover:underline focus-ring"
                title={fullDateTime(status.createdAt, i18n.language)}
              >
                <time dateTime={status.createdAt}>
                  {highlighted
                    ? fullDateTime(status.createdAt, i18n.language)
                    : relativeTime(status.createdAt, i18n.language)}
                </time>
              </Link>
              {status.editedAt && (
                <span
                  className="text-xs text-fg-muted"
                  title={t('status.editedAt', {
                    date: fullDateTime(status.editedAt, i18n.language),
                  })}
                >
                  {t('status.edited')}
                </span>
              )}
              <VisibilityBadge status={status} isAuthor={isAuthor} />
            </div>
          </header>

          {hasWarning && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
              <WarningIcon size={16} className="text-fg-muted" />
              <p className="min-w-0 flex-1 text-sm font-medium">{status.summary}</p>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((value) => !value)}
                className="rounded-full border border-border-strong px-3 py-0.5 text-xs font-medium hover:bg-surface focus-ring"
              >
                {expanded ? t('status.showLess') : t('status.showMore')}
              </button>
            </div>
          )}

          {editing && <EditStatusForm status={status} onDone={() => setEditing(false)} />}
          <div id={contentId} hidden={editing || (hasWarning && !expanded)}>
            {status.content && (
              <StatusContent
                html={status.content}
                mentions={status.mentions}
                className={cx('mt-2', highlighted ? 'text-lg' : 'text-[0.95rem]')}
              />
            )}
            {status.poll && <PollView status={status} poll={status.poll} />}
            {status.media.length > 0 && (
              <MediaGrid media={status.media} sensitive={status.sensitive && !hasWarning} />
            )}
          </div>

          <div className="-ml-2 mt-2 flex items-center gap-1 sm:gap-3">
            <ActionButton
              label={t('status.reply')}
              count={status.repliesCount}
              disabled={!signedIn}
              onClick={() => (onReply ? onReply() : setReplying((value) => !value))}
            >
              <ReplyIcon size={18} />
            </ActionButton>
            <ActionButton
              label={
                canReshare(status.visibility)
                  ? status.reblogged
                    ? t('status.unreshare')
                    : t('status.reshare')
                  : t('status.reshareUnavailable')
              }
              count={status.reblogsCount}
              active={status.reblogged}
              pressed={status.reblogged}
              activeClass="text-success"
              disabled={!signedIn || !canReshare(status.visibility)}
              onClick={() => act('reblog', !status.reblogged)}
            >
              <ReshareIcon size={18} />
            </ActionButton>
            <ActionButton
              label={status.liked ? t('status.unlike') : t('status.like')}
              count={status.likesCount}
              active={status.liked}
              pressed={status.liked}
              activeClass="text-danger"
              disabled={!signedIn}
              onClick={() => act('like', !status.liked)}
            >
              <HeartIcon size={18} filled={status.liked} />
            </ActionButton>
            <ActionButton
              label={status.bookmarked ? t('status.unbookmark') : t('status.bookmark')}
              active={status.bookmarked}
              pressed={status.bookmarked}
              activeClass="text-accent"
              disabled={!signedIn}
              onClick={() => act('bookmark', !status.bookmarked)}
            >
              <BookmarkIcon size={18} filled={status.bookmarked} />
            </ActionButton>
            <MoreMenu
              status={status}
              isAuthor={isAuthor}
              signedIn={signedIn}
              onEdit={() => setEditing(true)}
            />
          </div>
          {toggle.error && <Alert className="mt-2">{errorMessage(toggle.error)}</Alert>}

          {replying && (
            <div className="mt-3">
              <Composer
                replyTo={status}
                autoFocus
                compact
                onPosted={() => setReplying(false)}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
