import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

/** Text taller than this (about 14 lines) is shortened in timelines, with "Show all". */
export const LONG_TEXT_HEIGHT = 352;

/** Whether long texts are shortened here: yes in timelines, no on a thread's page. */
export const ShortenLongTextsContext = createContext(true);

/**
 * Shows the start of a long post with a fade and a button to read the rest, so one post does
 * not fill the whole screen (issue #30). Short texts are shown as they are.
 */
export function LongText({ children, id }: { children: ReactNode; id: string }) {
  const { t } = useTranslation();
  const shorten = useContext(ShortenLongTextsContext);
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!shorten || !element) return;
    const measure = () => setLong(element.scrollHeight > LONG_TEXT_HEIGHT + 48);
    measure();
    // Images, fonts and translations change the height after the first paint.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [shorten]);

  const closed = long && !open;
  return (
    <div>
      <div
        ref={ref}
        id={id}
        className={closed ? 'relative overflow-hidden' : undefined}
        style={closed ? { maxHeight: LONG_TEXT_HEIGHT } : undefined}
      >
        {children}
        {closed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface"
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          className="mt-1 rounded text-sm font-medium text-accent hover:underline focus-ring"
        >
          {open ? t('status.showLess') : t('status.showAll')}
        </button>
      )}
    </div>
  );
}
