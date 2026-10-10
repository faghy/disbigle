import type { Account } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { relationshipQueryOptions } from '../api/socialQueries.ts';
import { Button, cx } from './ui.tsx';

/**
 * Follow, unfollow or cancel a request. In lists, pass `fetch={false}` and load relationships
 * once with `useRelationships`; the button then reads them from the cache.
 */
export function FollowButton({
  account,
  compact = false,
  fetch = true,
}: {
  account: Account;
  compact?: boolean;
  fetch?: boolean;
}) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const isSelf = user?.account.id === account.id;
  const relationship = useQuery({
    ...relationshipQueryOptions(account.id),
    enabled: fetch && Boolean(user) && !isSelf,
  });
  const change = useMutation({
    mutationFn: (follow: boolean) =>
      social.accountAction(account.id, follow ? 'follow' : 'unfollow'),
    onSuccess: (rel) => {
      queryClient.setQueryData(socialKeys.relationship(account.id), rel);
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      void queryClient.invalidateQueries({ queryKey: socialKeys.followers(account.id) });
    },
  });

  if (!user || isSelf) return null;
  const rel = relationship.data;
  const size = compact ? 'min-h-8 px-3 py-1 text-xs' : undefined;
  if (!rel) {
    return (
      <Button variant="secondary" disabled className={cx(size, 'invisible')} aria-hidden="true">
        {t('profile.follow')}
      </Button>
    );
  }
  if (rel.blocking || rel.blockedBy) return null;

  const label = rel.following
    ? t('profile.unfollow')
    : rel.requested
      ? t('profile.requested')
      : rel.followedBy
        ? t('profile.followBack')
        : t('profile.follow');
  const name = account.displayName || account.username;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant={rel.following || rel.requested ? 'secondary' : 'primary'}
        className={size}
        loading={change.isPending}
        aria-label={
          rel.requested
            ? t('profile.cancelRequestFor', { name })
            : t('search.followLabel', { action: label, name })
        }
        onClick={() => change.mutate(!(rel.following || rel.requested))}
      >
        {label}
      </Button>
      {change.error && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(change.error)}
        </span>
      )}
    </span>
  );
}
