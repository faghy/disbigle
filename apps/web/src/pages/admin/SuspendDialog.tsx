import type { Account } from '@disbigle/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../api/errors.ts';
import { Modal } from '../../components/Dialog.tsx';
import { Alert, Button } from '../../components/ui.tsx';

/** Asks for an (optional) reason before suspending an account. */
export function SuspendDialog({
  account,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  account: Account;
  confirmLabel?: string;
  pending: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={t('admin.suspend.title', { acct: account.acct })}
      description={t('admin.suspend.description')}
      onClose={onClose}
      initialFocus="textarea"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason.trim());
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium">
            {t('admin.suspend.reason')}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="input-base"
          />
          <p className="text-xs text-fg-muted">{t('admin.suspend.reasonHint')}</p>
        </div>
        <Alert>{error ? errorMessage(error) : null}</Alert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            {confirmLabel ?? t('admin.suspend.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
