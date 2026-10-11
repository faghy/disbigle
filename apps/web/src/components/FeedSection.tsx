import type { ComponentType, ReactNode } from 'react';
import { cx } from './ui.tsx';

/** Page title above a feed, with an optional icon, description and actions. */
export function FeedHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 space-y-1">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="inline-flex size-11 shrink-0 -rotate-6 items-center justify-center rounded-2xl border-2 border-ink bg-sun text-ink shadow-[2px_2px_0_0_var(--ink)]">
            <Icon size={22} />
          </span>
        )}
        <h1 className="min-w-0 flex-1 truncate text-3xl font-extrabold tracking-tight">{title}</h1>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {description && (
        <p className={cx('text-sm text-fg-muted', Icon && 'sm:pl-14')}>{description}</p>
      )}
    </header>
  );
}

/** The card a list of posts sits in. */
export function FeedSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'sticker-soft overflow-visible rounded-3xl bg-surface [&>*:last-child>article:last-child]:border-b-0',
        className,
      )}
    >
      {children}
    </section>
  );
}
