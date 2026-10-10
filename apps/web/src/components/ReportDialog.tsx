import type { Account, Status } from '@disbigle/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { type ReportCategory, reportCategories, social } from '../api/social.ts';
import { relativeTime } from '../lib/time.ts';
import { Modal } from './Dialog.tsx';
import { Alert, Button, cx, LoadingState } from './ui.tsx';

/** How many of the account's posts a report can point to. */
export const MAX_REPORTED_POSTS = 5;
const RECENT_POSTS = 10;
const MAX_COMMENT = 1000;

/** Plain text of server HTML, for short previews. */
function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/**
 * Reports an account to the moderators: a category, an optional comment and, optionally,
 * some of the account's recent posts (the post the report started from is preselected).
 */
export function ReportDialog({
  account,
  status,
  onClose,
}: {
  account: Account;
  status?: Status | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ids = { category: useId(), comment: useId(), posts: useId() };
  const [category, setCategory] = useState<ReportCategory>('spam');
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<string[]>(status ? [status.id] : []);

  const recent = useQuery({
    queryKey: ['reportCandidates', account.id],
    queryFn: () => social.accountStatuses(account.id, { limit: RECENT_POSTS }),
  });
  const report = useMutation({ mutationFn: social.report });

  // The post being reported first, then the account's other recent posts (reshares excluded).
  const candidates = [
    ...(status ? [status] : []),
    ...(recent.data ?? []).filter((s) => !s.reblog && s.id !== status?.id),
  ];
  const name = account.displayName || account.username;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    report.mutate({
      accountId: account.id,
      statusIds: selected,
      category,
      comment: comment.trim(),
    });
  };

  if (report.isSuccess) {
    return (
      <Modal title={t('report.doneTitle')} onClose={onClose} initialFocus="[data-done]">
        <p role="status" className="text-fg-muted">
          {t('report.doneBody', { name })}
        </p>
        <div className="mt-5 flex justify-end">
          <Button data-done onClick={onClose}>
            {t('common.done')}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('report.title', { name })}
      description={t('report.description')}
      onClose={onClose}
      initialFocus="input[type=radio]:checked"
      wide
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <fieldset>
          <legend id={ids.category} className="mb-2 text-sm font-semibold">
            {t('report.categoryLegend')}
          </legend>
          <div className="space-y-1">
            {reportCategories.map((value) => (
              <label
                key={value}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5',
                  category === value
                    ? 'border-accent/60 bg-accent-soft/50'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                <input
                  type="radio"
                  name={ids.category}
                  value={value}
                  checked={category === value}
                  onChange={() => setCategory(value)}
                  className="mt-1 size-4 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {t(`report.categories.${value}.label`)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {t(`report.categories.${value}.description`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset aria-describedby={`${ids.posts}-hint`}>
          <legend className="text-sm font-semibold">{t('report.postsLegend')}</legend>
          <p id={`${ids.posts}-hint`} className="mb-2 text-xs text-fg-muted">
            {t('report.postsHint', { max: MAX_REPORTED_POSTS })}
          </p>
          {recent.isPending && !status ? (
            <LoadingState label={t('common.loading')} />
          ) : candidates.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('report.noPosts')}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {candidates.map((post) => {
                const checked = selected.includes(post.id);
                const full = !checked && selected.length >= MAX_REPORTED_POSTS;
                const text =
                  post.summary || plainText(post.content) || t('notifications.mediaPost');
                return (
                  <li key={post.id}>
                    <label
                      className={cx(
                        'flex items-start gap-3 rounded-lg px-2 py-2',
                        full ? 'opacity-50' : 'cursor-pointer hover:bg-surface-muted',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-accent"
                        checked={checked}
                        disabled={full}
                        onChange={(event) =>
                          setSelected((list) =>
                            event.target.checked
                              ? [...list, post.id]
                              : list.filter((id) => id !== post.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm">{text}</span>
                        <span className="text-xs text-fg-muted">
                          {relativeTime(post.createdAt, i18n.language)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor={ids.comment} className="block text-sm font-semibold">
            {t('report.comment')}
          </label>
          <textarea
            id={ids.comment}
            rows={3}
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('report.commentPlaceholder')}
            aria-describedby={`${ids.comment}-hint`}
            className="input-base"
          />
          <p id={`${ids.comment}-hint`} className="text-xs text-fg-muted">
            {t('report.commentHint', { count: MAX_COMMENT - comment.length })}
          </p>
        </div>

        <Alert>{report.error ? errorMessage(report.error) : null}</Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={report.isPending}>
            {t('report.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
