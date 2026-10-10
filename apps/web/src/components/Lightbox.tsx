import type { MediaAttachment } from '@disbigle/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from './Dialog.tsx';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons.tsx';

const navButton =
  'inline-flex size-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-ring';

/** Full-screen image viewer with keyboard navigation (arrows, Escape). */
export function Lightbox({
  media,
  startIndex,
  onClose,
}: {
  media: MediaAttachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(startIndex);
  const ref = useRef<HTMLDivElement>(null);
  const trap = useFocusTrap(ref, '[data-close]');
  const item = media[index];
  if (!item) return null;
  const many = media.length > 1;
  const go = (delta: number) => setIndex((i) => (i + delta + media.length) % media.length);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t('status.media.viewer')}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowRight' && many) go(1);
        else if (event.key === 'ArrowLeft' && many) go(-1);
        trap(event);
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex justify-end p-3">
        <button
          type="button"
          data-close
          className={navButton}
          onClick={onClose}
          aria-label={t('common.close')}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-2 pb-4">
        {many && (
          <button
            type="button"
            className={navButton}
            onClick={() => go(-1)}
            aria-label={t('status.media.previous')}
          >
            <ChevronLeftIcon />
          </button>
        )}
        <figure className="flex max-h-full min-w-0 flex-1 flex-col items-center gap-2">
          <img
            src={item.url}
            alt={item.description}
            className="max-h-[calc(100dvh-9rem)] max-w-full object-contain"
          />
          {item.description && (
            <figcaption className="max-w-2xl text-center text-sm text-white/80">
              {item.description}
            </figcaption>
          )}
        </figure>
        {many && (
          <button
            type="button"
            className={navButton}
            onClick={() => go(1)}
            aria-label={t('status.media.next')}
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>
      {many && (
        <p className="pb-3 text-center text-sm text-white/70" aria-live="polite">
          {t('status.media.position', { current: index + 1, total: media.length })}
        </p>
      )}
    </div>
  );
}
