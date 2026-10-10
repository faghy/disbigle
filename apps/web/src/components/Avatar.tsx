import type { Account } from '@disbigle/shared';
import { cx } from './ui.tsx';

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s_.-]+/u)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[1]] : [words[0]];
  return letters
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toUpperCase();
}

const sizes = {
  sm: 'size-8 text-xs',
  md: 'size-12 text-base',
  lg: 'size-20 text-2xl',
};

export function Avatar({
  account,
  size = 'md',
  className,
}: {
  account: Pick<Account, 'displayName' | 'username' | 'avatarUrl'>;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const name = account.displayName || account.username;
  const classes = cx(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
    'bg-accent-soft font-semibold text-accent select-none',
    sizes[size],
    className,
  );
  if (account.avatarUrl) {
    return <img src={account.avatarUrl} alt="" className={cx(classes, 'object-cover')} />;
  }
  return (
    <span className={classes} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
