/** What Disbigle takes from a diaspora* export ("Download my profile data"). */
export interface DiasporaSummary {
  displayName: string;
  bio: string;
  aspects: string[];
  contacts: { address: string; aspects: string[] }[];
  tags: string[];
  blocks: string[];
}

interface Raw {
  user?: Raw;
  profile?: { entity_data?: { first_name?: string; last_name?: string; bio?: string } };
  contact_groups?: { name?: string }[];
  contacts?: {
    account_id?: string;
    following?: boolean;
    sharing?: boolean;
    contact_groups_membership?: string[];
  }[];
  followed_tags?: string[];
  blocks?: string[];
}

/**
 * Reads a diaspora* export in the browser: gzipped (`.json.gz`) or plain JSON. Only the profile
 * name and description, aspects, the people you shared with, hashtags and blocks are kept: the
 * archive and its private key never leave this computer.
 */
export async function readDiasporaExport(file: Blob): Promise<DiasporaSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped
    ? await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).text()
    : new TextDecoder().decode(bytes);
  const json = JSON.parse(text) as Raw;
  const user = json.user ?? json;
  if (!user.contacts && !user.profile && !user.contact_groups) throw new Error('not_diaspora');
  const profile = user.profile?.entity_data ?? {};
  return {
    displayName: [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim(),
    bio: (profile.bio ?? '').trim(),
    aspects: (user.contact_groups ?? []).map((g) => g.name ?? '').filter(Boolean),
    contacts: (user.contacts ?? [])
      .filter((c) => (c.following ?? c.sharing) && c.account_id)
      .map((c) => ({
        address: c.account_id as string,
        aspects: c.contact_groups_membership ?? [],
      })),
    tags: user.followed_tags ?? [],
    blocks: user.blocks ?? [],
  };
}
