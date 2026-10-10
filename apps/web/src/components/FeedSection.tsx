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
    <header className="mb-4 flex flex-wrap items-center gap-3">
      {Icon && (
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon size={22} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

/** The card a list of posts sits in. */
export function FeedSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'overflow-visible rounded-2xl border border-border bg-surface shadow-sm [&>*:last-child>article:last-child]:border-b-0',
        className,
      )}
    >
      {children}
    </section>
  );
}
