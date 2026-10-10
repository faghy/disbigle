import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, adminKeys, type PendingUser } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { AccountRow } from '../../components/AccountList.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Alert, Button, Card, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

export function PendingPage() {
  const { t } = useTranslation();
  const pending = useQuery({ queryKey: adminKeys.pending, queryFn: admin.pending });
  const [done, setDone] = useState<string | null>(null);

  if (pending.isPending) return <LoadingState label={t('common.loading')} />;
  if (pending.isError) return <Alert>{errorMessage(pending.error)}</Alert>;

  return (
    <section aria-labelledby="pending-title" className="space-y-3">
      <h2 id="pending-title" className="sr-only">
        {t('admin.tabs.pending')}
      </h2>
      <p role="status" className="text-sm text-success empty:hidden">
        {done}
      </p>
      {pending.data.length === 0 ? (
        <Card className="text-center text-fg-muted">{t('admin.pending.empty')}</Card>
      ) : (
        <ul className="space-y-3">
          {pending.data.map((item) => (
            <li key={item.userId}>
              <PendingItem item={item} onDone={setDone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingItem({ item, onDone }: { item: PendingUser; onDone: (message: string) => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmReject, setConfirmReject] = useState(false);
  const acct = item.account.acct;

  const afterDecision = () => {
    queryClient.setQueryData<PendingUser[]>(adminKeys.pending, (list) =>
      list?.filter((p) => p.userId !== item.userId),
    );
    void queryClient.invalidateQueries({ queryKey: adminKeys.summary });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
  };
  const approve = useMutation({
    mutationFn: () => admin.approve(item.userId),
    onSuccess: () => {
      afterDecision();
      onDone(t('admin.pending.approved', { acct }));
    },
  });
  const reject = useMutation({
    mutationFn: () => admin.reject(item.userId),
    onSuccess: () => {
      setConfirmReject(false);
      afterDecision();
      onDone(t('admin.pending.rejected', { acct }));
    },
  });

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <AccountRow account={item.account} />
        </div>
        <time
          dateTime={item.createdAt}
          title={fullDateTime(item.createdAt, i18n.language)}
          className="text-xs text-fg-muted"
        >
          {relativeTime(item.createdAt, i18n.language)}
        </time>
      </div>
      <p className="px-2 text-sm text-fg-muted">
        {t('admin.pending.email')}: <span className="text-fg">{item.email}</span>
      </p>
      <figure className="mx-2 rounded-xl border border-border bg-surface-muted px-4 py-3">
        <figcaption className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {t('admin.pending.reason')}
        </figcaption>
        {item.reason ? (
          <blockquote className="mt-1 text-sm whitespace-pre-wrap break-words">
            {item.reason}
          </blockquote>
        ) : (
          <p className="mt-1 text-sm text-fg-muted italic">{t('admin.pending.noReason')}</p>
        )}
      </figure>
      <Alert>
        {approve.error || reject.error ? errorMessage(approve.error ?? reject.error) : null}
      </Alert>
      <div className="flex flex-wrap gap-2 px-2">
        <Button
          loading={approve.isPending}
          disabled={reject.isPending}
          onClick={() => approve.mutate()}
          aria-label={t('admin.pending.approveLabel', { acct })}
        >
          {t('admin.pending.approve')}
        </Button>
        <Button
          variant="danger"
          disabled={approve.isPending}
          onClick={() => setConfirmReject(true)}
          aria-label={t('admin.pending.rejectLabel', { acct })}
        >
          {t('admin.pending.reject')}
        </Button>
      </div>
      {confirmReject && (
        <ConfirmDialog
          title={t('admin.pending.rejectTitle', { acct })}
          description={t('admin.pending.rejectDescription')}
          confirmLabel={t('admin.pending.reject')}
          pending={reject.isPending}
          onCancel={() => setConfirmReject(false)}
          onConfirm={() => reject.mutate()}
        />
      )}
    </Card>
  );
}
