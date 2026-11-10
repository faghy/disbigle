import type { Account } from '@disbigle/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModerationGround } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { Modal } from '../../components/Dialog.tsx';
import { Alert, Button } from '../../components/ui.tsx';

/** Against the law or against the server rules: told to the person with the reason. */
export function GroundField({
  value,
  onChange,
}: {
  value: ModerationGround;
  onChange: (value: ModerationGround) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{t('admin.moderation.ground')}</legend>
      {(['rules', 'illegal'] as const).map((ground) => (
        <label key={ground} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="ground"
            value={ground}
            checked={value === ground}
            onChange={() => onChange(ground)}
            className="accent-[var(--color-accent)]"
          />
          {t(`admin.moderation.grounds.${ground}`)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Asks for the ground and reason before suspending an account; the owner receives them by
 * email with how to contest (statement of reasons, DSA art. 17).
 */
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
  onConfirm: (reason: string, ground: ModerationGround) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const [ground, setGround] = useState<ModerationGround>('rules');
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
          onConfirm(reason.trim(), ground);
        }}
      >
        <GroundField value={ground} onChange={setGround} />
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
          <p className="text-xs text-fg-muted">{t('admin.moderation.reasonHint')}</p>
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
