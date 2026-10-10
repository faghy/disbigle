import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, adminKeys, type Report } from '../../api/admin.ts';
import { ApiError } from '../../api/client.ts';
import { errorMessage } from '../../api/errors.ts';
import { statusQueryOptions } from '../../api/socialQueries.ts';
import { AccountLink, displayName, statusPath } from '../../components/StatusCard.tsx';
import { Alert, Button, Card, cx, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';
import { SuspendDialog } from './SuspendDialog.tsx';

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

function ReportedPost({ id }: { id: string }) {
  const { t } = useTranslation();
  const status = useQuery({ ...statusQueryOptions(id), retry: false });
  if (status.isPending) return <span className="text-sm text-fg-muted">{t('common.loading')}</span>;
  if (status.isError) {
    const gone = status.error instanceof ApiError && status.error.status === 404;
    return (
      <span className="text-sm text-fg-muted italic">
        {gone ? t('admin.reports.postUnavailable') : errorMessage(status.error)}
      </span>
    );
  }
  const post = status.data;
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
  const resolve = useMutation({
    mutationFn: () => admin.resolveReport(report.id),
    onSuccess: refresh,
  });
  const suspend = useMutation({
    mutationFn: async (reason: string) => {
      if (!report.target) return;
      await admin.suspend(report.target.id, reason);
      await admin.resolveReport(report.id);
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
          {report.reporter ? (
            <AccountLink account={report.reporter} className="hover:underline">
              @{report.reporter.acct}
            </AccountLink>
          ) : (
            t('admin.reports.unknownAccount')
          )}
        </dd>
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
                <ReportedPost id={id} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Alert>{resolve.error ? errorMessage(resolve.error) : null}</Alert>
      {!report.resolvedAt && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate()}>
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
          onConfirm={(reason) => suspend.mutate(reason)}
          onClose={() => {
            setSuspending(false);
            suspend.reset();
          }}
        />
      )}
    </Card>
  );
}
