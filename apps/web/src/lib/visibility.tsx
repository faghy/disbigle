import type { Visibility } from '@disbigle/shared';
import type { ComponentType, SVGProps } from 'react';
import { AspectsIcon, AtIcon, GlobeIcon, LockIcon, UnlistedIcon } from '../components/icons.tsx';

export const visibilityIcons: Record<
  Visibility,
  ComponentType<SVGProps<SVGSVGElement> & { size?: number }>
> = {
  public: GlobeIcon,
  unlisted: UnlistedIcon,
  followers: LockIcon,
  limited: AspectsIcon,
  direct: AtIcon,
};

/** Order shown in the audience picker: widest audience first. */
export const visibilityOrder: Visibility[] = [
  'public',
  'unlisted',
  'followers',
  'limited',
  'direct',
];

/** Reshares are only possible for posts anyone may see. */
export const canReshare = (visibility: Visibility) =>
  visibility === 'public' || visibility === 'unlisted';

/** Replies to these posts stay inside the original audience (enforced by the server). */
export const isPrivateConversation = (visibility: Visibility) =>
  visibility === 'limited' || visibility === 'direct';
