import type { Group, GroupPrivacy, GroupSummary } from '@disbigle/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar.tsx';
import { EyeOffIcon, GlobeIcon, LockIcon } from './icons.tsx';
import { cx } from './ui.tsx';

/** A group's picture, or its initials. */
export function GroupAvatar({
  group,
  size = 'md',
  className,
}: {
  group: Pick<GroupSummary, 'name' | 'handle' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <Avatar
      account={{ displayName: group.name, username: group.handle, avatarUrl: group.avatarUrl }}
      size={size}
      className={cx('rounded-xl', className)}
    />
  );
}

const privacyIcons: Record<GroupPrivacy, typeof GlobeIcon> = {
  public: GlobeIcon,
  private: LockIcon,
  secret: EyeOffIcon,
};

/** "Public group", "Private group" or "Secret group", with its icon. */
export function PrivacyLabel({
  privacy,
  className,
}: {
  privacy: GroupPrivacy;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = privacyIcons[privacy];
  return (
    <span className={cx('inline-flex items-center gap-1 text-sm text-fg-muted', className)}>
      <Icon size={15} />
      {t(`groups.privacy.${privacy}.label`)}
    </span>
  );
}

/** One group in a list: picture, name, privacy, members and description. */
export function GroupCard({ group, actions }: { group: Group; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <article className="flex gap-3 px-4 py-3 sm:px-5">
      <GroupAvatar group={group} />
      <div className="min-w-0 flex-1">
        <Link
          to="/groups/$handle"
          params={{ handle: group.handle }}
          className="rounded font-semibold break-words hover:underline focus-ring"
        >
          {group.name}
        </Link>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <PrivacyLabel privacy={group.privacy} />
          <span className="text-sm text-fg-muted">
            {t('groups.members', { count: group.membersCount })}
          </span>
        </p>
        {group.description && (
          <p className="mt-1 line-clamp-2 text-sm break-words text-fg-muted">{group.description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-start gap-2">{actions}</div>}
    </article>
  );
}
