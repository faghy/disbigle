import type { Config } from '@disbigle/config';

/** Canonical federation URLs of a local actor. */
export function localActorUrls(
  config: Pick<Config, 'PUBLIC_URL'>,
  username: string,
  diasporaGuid: string,
) {
  const base = config.PUBLIC_URL;
  const uri = `${base}/users/${username}`;
  return {
    apUri: uri,
    apUrl: `${base}/@${username}`,
    apInbox: `${uri}/inbox`,
    apOutbox: `${uri}/outbox`,
    apFollowers: `${uri}/followers`,
    apSharedInbox: `${base}/inbox`,
    diasporaReceiveUrl: `${base}/receive/users/${diasporaGuid}`,
  };
}
