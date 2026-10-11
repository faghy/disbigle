import { useRouterState } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Composer } from './Composer.tsx';
import { useFocusTrap } from './Dialog.tsx';
import { CloseIcon, PenIcon } from './icons.tsx';

/** Pages where a floating compose button would be in the way. */
const hiddenOn = ['/settings', '/admin', '/messages'];

/**
 * Mobile only: a floating "new post" button above the bottom bar, opening the composer in a
 * full-screen sheet.
 */
export function ComposeButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (hiddenOn.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t('composer.label')}
        title={t('composer.label')}
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg hover:bg-accent-hover focus-ring md:hidden"
      >
        <PenIcon size={24} />
      </button>
      {open && (
        <ComposeSheet
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ComposeSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const trap = useFocusTrap(ref, 'textarea');
  const titleId = useId();
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
        trap(event);
      }}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg md:hidden"
    >
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-2 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted focus-ring"
        >
          <CloseIcon size={20} />
        </button>
        <h2 id={titleId} className="font-semibold">
          {t('composer.label')}
        </h2>
      </header>
      <div className="p-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Composer autoFocus compact onPosted={onClose} />
      </div>
    </div>
  );
}
