import type { InstanceInfo } from '@disbigle/shared';

type Analytics = NonNullable<InstanceInfo['analytics']>;

/** Browsers that ask not to be tracked (Do Not Track, Global Privacy Control) send nothing. */
export function trackingRefused(nav: Navigator = navigator): boolean {
  const withGpc = nav as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || withGpc.globalPrivacyControl === true;
}

/**
 * The address Matomo gets for a screen: the route's pattern with its parameters replaced by
 * what they are (`/@{$username}/$statusId` → `/@profile/post`), so no name, post or tag leaves.
 */
export function genericPath(routePattern: string): string {
  const path = routePattern
    .replace('@{$username}', '@profile')
    .replace('$statusId', 'post')
    .replace(/\$([A-Za-z]+)/g, (_, name: string) => name)
    .replace(/\/+$/, '');
  return path || '/';
}

/**
 * A page view through Matomo's tracking API, as an image request: no cookie, no script from the
 * Matomo server, and nothing but the generic address, the screen size and the language.
 */
export function trackPageView(
  analytics: Analytics,
  routePattern: string,
  origin = window.location.origin,
) {
  const path = genericPath(routePattern);
  const params = new URLSearchParams({
    idsite: String(analytics.siteId),
    rec: '1',
    apiv: '1',
    url: origin + path,
    action_name: path,
    res: `${window.screen.width}x${window.screen.height}`,
    lang: navigator.language,
    rand: String(Math.random()).slice(2, 10),
  });
  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  image.src = `${analytics.matomoUrl.replace(/\/+$/, '')}/matomo.php?${params}`;
}
