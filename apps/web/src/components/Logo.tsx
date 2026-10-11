import { cx } from './ui.tsx';

/**
 * The Disbigle mark: a speech bubble that winks. Conversation, with the cheek of the name
 * ("sei un disbiglio!"). Colours come from the theme tokens.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cx('shrink-0 overflow-visible', className)}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M14 7h36a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H29L16.5 59l2-10H14A10 10 0 0 1 4 39V17A10 10 0 0 1 14 7Z"
        fill="var(--accent)"
        stroke="var(--ink)"
        strokeWidth="3.2"
      />
      <circle cx="17.5" cy="33" r="3.4" fill="var(--sun)" />
      <circle cx="47" cy="33" r="3.4" fill="var(--sun)" />
      <circle cx="23.5" cy="23.5" r="3.6" fill="var(--ink)" />
      <path d="M36.5 24.5q4.6-5.2 9.2 0" stroke="var(--ink)" strokeWidth="3.2" />
      <path d="M22 33.5q10.3 9.5 20.6 0" stroke="var(--ink)" strokeWidth="3.2" />
    </svg>
  );
}

/** Mark and name, as in the top bar. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark className={cx('size-9 -rotate-6', markClassName)} />
      <span className="font-display text-[1.45rem] leading-none font-extrabold tracking-tight">
        disbigle
      </span>
    </span>
  );
}
