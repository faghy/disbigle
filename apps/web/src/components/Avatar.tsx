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

/** Fallback colours: each person keeps theirs, so a feed without photos is still lively. */
// Light in both themes, so the dark letter always reads.
const tones = ['bg-sun', 'bg-mint', 'bg-sky', 'bg-lilac', 'bg-peach'];
function toneOf(name: string): string {
  // FNV-1a: similar names still land on different colours.
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return tones[hash % tones.length] ?? 'bg-sun';
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
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-ink',
    'font-display font-extrabold text-ink select-none',
    !account.avatarUrl && toneOf(account.username),
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
