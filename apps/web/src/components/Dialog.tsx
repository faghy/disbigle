import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons.tsx';
import { Button, cx } from './ui.tsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the element and returns focus to the previously focused control on close. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, initial?: string) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = initial ? ref.current?.querySelector<HTMLElement>(initial) : null;
    (target ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => previous?.focus?.();
  }, [ref, initial]);

  return (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

export interface ConfirmDialogProps {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  danger?: boolean;
}

/** A small modal asking to confirm a destructive action. Escape or the backdrop cancels. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  danger = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trap = useFocusTrap(ref, '[data-cancel]');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-sm sticker-soft rounded-3xl bg-surface p-5"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) {
            event.stopPropagation();
            onCancel();
          }
          trap(event);
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm text-fg-muted">
            {description}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" data-cancel onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A general modal dialog with a title and a close button; Escape or the backdrop closes it. */
export function Modal({
  title,
  description,
  onClose,
  children,
  initialFocus,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: string;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trap = useFocusTrap(ref, initialFocus);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          trap(event);
        }}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
