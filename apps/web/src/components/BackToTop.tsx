import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpIcon } from './icons.tsx';
import { cx } from './ui.tsx';

/** How far down the page the button shows up. */
const THRESHOLD = 800;

/**
 * A round button at the bottom right, once you have scrolled a good way down, that takes you
 * back to the top of the page. On phones it sits above the button for writing a post.
 */
export function BackToTop({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const update = () => setShown(window.scrollY > THRESHOLD);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  if (!shown) return null;
  return (
    <button
      type="button"
      aria-label={t('nav.backToTop')}
      title={t('nav.backToTop')}
      onClick={() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        document.getElementById('main')?.focus({ preventScroll: true });
      }}
      className={cx(
        'fixed right-5 z-30 inline-flex size-11 items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow-lg hover:bg-surface-muted hover:text-fg focus-ring md:right-6 md:bottom-6',
        signedIn
          ? 'bottom-[calc(8.75rem+env(safe-area-inset-bottom))]'
          : 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
      )}
    >
      <ArrowUpIcon size={20} />
    </button>
  );
}
