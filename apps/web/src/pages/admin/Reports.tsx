import type { Status } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  admin,
  adminKeys,
  type ModerationGround,
  type Report,
  type ReportDecision,
} from '../../api/admin.ts';
import { ApiError } from '../../api/client.ts';
import { errorMessage } from '../../api/errors.ts';
import { statusQueryOptions } from '../../api/socialQueries.ts';
import { Modal } from '../../components/Dialog.tsx';
import { AccountLink, displayName, statusPath } from '../../components/StatusCard.tsx';
import { Alert, Button, Card, cx, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';
import { GroundField, SuspendDialog } from './SuspendDialog.tsx';

export function ReportsPage() {
  const { t } = useTranslation();
  const [resolved, setResolved] = useState(false);
  const reports = useQuery({
    queryKey: adminKeys.reports(resolved),
    queryFn: () => admin.reports(resolved),
  });

  return (
    <section aria-labelledby="reports-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="reports-title" className="sr-only">
          {t('admin.tabs.reports')}
        </h2>
        <fieldset className="inline-flex rounded-lg border border-border p-0.5">
          <legend className="sr-only">{t('admin.reports.filter')}</legend>
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={resolved === value}
              onClick={() => setResolved(value)}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm font-medium focus-ring',
                resolved === value ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:text-fg',
              )}
            >
              {value ? t('admin.reports.resolved') : t('admin.reports.open')}
            </button>
          ))}
        </fieldset>
      </div>
      {reports.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : reports.isError ? (
        <Alert>{errorMessage(reports.error)}</Alert>
      ) : reports.data.length === 0 ? (
        <Card className="text-center text-fg-muted">
          {resolved ? t('admin.reports.emptyResolved') : t('admin.reports.emptyOpen')}
        </Card>
      ) : (
        <ul className="space-y-3">
          {reports.data.map((report) => (
            <li key={report.id}>
              <ReportItem report={report} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A reported post. Reports carry the posts (also private ones) for moderators; only when one
 * is missing is it fetched, with the usual visibility rules.
 */
function ReportedPost({
  id,
  included,
  onRemove,
}: {
  id: string;
  included?: Status | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const status = useQuery({ ...statusQueryOptions(id), retry: false, enabled: !included });
  if (included)
    return (
      <div className="space-y-1.5">
        <PostExcerpt post={included} />
        {onRemove && (
          <Button variant="secondary" onClick={onRemove}>
            {t('admin.moderation.removePost')}
          </Button>
        )}
      </div>
    );
  if (status.isPending) return <span className="text-sm text-fg-muted">{t('common.loading')}</span>;
  if (status.isError) {
    const gone = status.error instanceof ApiError && status.error.status === 404;
    return (
      <span className="text-sm text-fg-muted italic">
        {gone ? t('admin.reports.postUnavailable') : errorMessage(status.error)}
      </span>
    );
  }
  return <PostExcerpt post={status.data} />;
}

function PostExcerpt({ post }: { post: Status }) {
  const { t } = useTranslation();
  const text = new DOMParser().parseFromString(post.content, 'text/html').body.textContent ?? '';
  return (
    <Link
      {...statusPath(post)}
      className="block rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-sm hover:border-border-strong focus-ring"
    >
      {post.summary && <span className="mb-1 block font-medium">{post.summary}</span>}
      <span className="line-clamp-3">{text || t('notifications.mediaPost')}</span>
    </Link>
  );
}

function ReportItem({ report }: { report: Report }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [suspending, setSuspending] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
    void queryClient.invalidateQueries({ queryKey: adminKeys.summary });
  };
  const [deciding, setDeciding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: (input: { decision: ReportDecision; reason: string }) =>
      admin.resolveReport(report.id, input),
    onSuccess: () => {
      setDeciding(false);
      refresh();
    },
  });
  // Removing a post also closes the report, with the same reason (the reporter is told).
  const remove = useMutation({
    mutationFn: async (input: { statusId: string; ground: ModerationGround; reason: string }) => {
      await admin.removePost(input.statusId, {
        ground: input.ground,
        reason: input.reason,
        reportId: report.id,
      });
      if (!report.resolvedAt)
        await admin.resolveReport(report.id, { decision: 'removed', reason: input.reason });
    },
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  const suspend = useMutation({
    mutationFn: async ({ reason, ground }: { reason: string; ground: ModerationGround }) => {
      if (!report.target) return;
      await admin.suspend(report.target.id, reason, ground);
      await admin.resolveReport(report.id, { decision: 'suspended', reason });
    },
    onSuccess: () => {
      setSuspending(false);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    },
  });

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">
          {t(`report.categories.${report.category}.label`)}
        </span>
        <time
          dateTime={report.createdAt}
          title={fullDateTime(report.createdAt, i18n.language)}
          className="text-xs text-fg-muted"
        >
          {relativeTime(report.createdAt, i18n.language)}
        </time>
        {report.resolvedAt && (
          <span className="ml-auto text-xs text-success">
            {t('admin.reports.resolvedAt', {
              date: fullDateTime(report.resolvedAt, i18n.language),
            })}
          </span>
        )}
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-fg-muted">{t('admin.reports.target')}</dt>
        <dd>
          {report.target ? (
            <AccountLink account={report.target} className="font-medium hover:underline">
              {displayName(report.target)}{' '}
              <span className="text-fg-muted">@{report.target.acct}</span>
            </AccountLink>
          ) : (
            t('admin.reports.unknownAccount')
          )}
        </dd>
        <dt className="text-fg-muted">{t('admin.reports.reporter')}</dt>
        <dd>
          {report.source === 'public' ? (
            <span>
              {t('admin.reports.publicNotice')}
              {report.notifierName && ` · ${report.notifierName}`}
              {report.notifierEmail && (
                <>
                  {' · '}
                  <a href={`mailto:${report.notifierEmail}`} className="underline">
                    {report.notifierEmail}
                  </a>
                </>
              )}
            </span>
          ) : report.reporter ? (
            <AccountLink account={report.reporter} className="hover:underline">
              @{report.reporter.acct}
              {report.source === 'remote' && ` (${t('admin.reports.remoteServer')})`}
            </AccountLink>
          ) : (
            t('admin.reports.unknownAccount')
          )}
        </dd>
        {report.contentUrl && (
          <>
            <dt className="text-fg-muted">{t('admin.reports.contentUrl')}</dt>
            <dd className="break-all">
              <a href={report.contentUrl} className="underline" rel="noreferrer" target="_blank">
                {report.contentUrl}
              </a>
            </dd>
          </>
        )}
        {report.decision && (
          <>
            <dt className="text-fg-muted">{t('admin.reports.decision')}</dt>
            <dd>
              <span className="font-medium">
                {t(`admin.moderation.decisions.${report.decision}`)}
              </span>
              {report.decisionReason && (
                <span className="block whitespace-pre-wrap text-fg-muted">
                  {report.decisionReason}
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-fg-muted">{t('admin.reports.comment')}</dt>
        <dd className="whitespace-pre-wrap break-words">
          {report.comment || (
            <span className="text-fg-muted italic">{t('admin.reports.noComment')}</span>
          )}
        </dd>
      </dl>
      {report.statusIds.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            {t('admin.reports.posts', { count: report.statusIds.length })}
          </h3>
          <ul className="space-y-2">
            {report.statusIds.map((id) => (
              <li key={id}>
                <ReportedPost
                  id={id}
                  included={report.statuses?.find((s) => s.id === id)}
                  onRemove={() => setRemoving(id)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {!report.resolvedAt && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDeciding(true)}>
            {t('admin.reports.resolve')}
          </Button>
          {report.target && (
            <Button variant="danger" onClick={() => setSuspending(true)}>
              {t('admin.reports.suspendTarget')}
            </Button>
          )}
        </div>
      )}
      {suspending && report.target && (
        <SuspendDialog
          account={report.target}
          confirmLabel={t('admin.reports.suspendAndResolve')}
          pending={suspend.isPending}
          error={suspend.error}
          onConfirm={(reason, ground) => suspend.mutate({ reason, ground })}
          onClose={() => {
            setSuspending(false);
            suspend.reset();
          }}
        />
      )}
      {deciding && (
        <DecisionDialog
          pending={resolve.isPending}
          error={resolve.error}
          onConfirm={(input) => resolve.mutate(input)}
          onClose={() => {
            setDeciding(false);
            resolve.reset();
          }}
        />
      )}
      {removing && (
        <RemovePostDialog
          pending={remove.isPending}
          error={remove.error}
          onConfirm={(input) => remove.mutate({ statusId: removing, ...input })}
          onClose={() => {
            setRemoving(null);
            remove.reset();
          }}
        />
      )}
    </Card>
  );
}

/** Closes a report with its decision and reason; whoever reported is told (DSA art. 16). */
function DecisionDialog({
  pending,
  error,
  onConfirm,
  onClose,
}: {
  pending: boolean;
  error: unknown;
  onConfirm: (input: { decision: ReportDecision; reason: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [decision, setDecision] = useState<ReportDecision>('no_violation');
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('admin.moderation.decideTitle')}
      description={t('admin.moderation.decideDescription')}
      onClose={onClose}
      initialFocus="textarea"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ decision, reason: reason.trim() });
        }}
      >
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('admin.reports.decision')}</legend>
          {(['no_violation', 'removed', 'suspended'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="decision"
                checked={decision === value}
                onChange={() => setDecision(value)}
              />
              {t(`admin.moderation.decisions.${value}`)}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium">
            {t('admin.moderation.reason')}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="input-base"
          />
          <p className="text-xs text-fg-muted">{t('admin.moderation.decisionHint')}</p>
        </div>
        <Alert>{error ? errorMessage(error) : null}</Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('admin.moderation.decideConfirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Removes a reported post; its author gets the ground and reason by email (DSA art. 17). */
function RemovePostDialog({
  pending,
  error,
  onConfirm,
  onClose,
}: {
  pending: boolean;
  error: unknown;
  onConfirm: (input: { ground: ModerationGround; reason: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [ground, setGround] = useState<ModerationGround>('rules');
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('admin.moderation.removeTitle')}
      description={t('admin.moderation.removeDescription')}
      onClose={onClose}
      initialFocus="textarea"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ ground, reason: reason.trim() });
        }}
      >
        <GroundField value={ground} onChange={setGround} />
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium">
            {t('admin.moderation.reason')}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="input-base"
          />
          <p className="text-xs text-fg-muted">{t('admin.moderation.reasonHint')}</p>
        </div>
        <Alert>{error ? errorMessage(error) : null}</Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            {t('admin.moderation.removeConfirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
