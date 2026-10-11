// Conversion of diaspora* text and profiles to Disbigle conventions.
import type { PollRow, ProfileRow } from './source/types.ts';

/** diaspora* mention syntax: `@{Name; user@host}` or `@{user@host}`. */
const DIASPORA_MENTION = /@\{(?:([^}]*?);\s*)?([^}\s;]+@[^}\s;]+)\s*\}/g;

const MENTIONABLE_USERNAME = /^[a-zA-Z0-9_]{1,30}$/;
const MENTIONABLE_DOMAIN =
  /^(?:[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d{1,5})?|localhost(?::\d{1,5})?)$/;

export interface MentionTarget {
  username: string;
  /** null for local accounts. */
  domain: string | null;
  /** Profile URL, used when the handle cannot be written as `@user@host`. */
  url: string | null;
}

/** diaspora* IDs (`user@host`, lowercased) mentioned in a text. */
export function diasporaMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(DIASPORA_MENTION)].map((m) => (m[2] ?? '').toLowerCase()))];
}

const escapeLabel = (text: string) => text.replace(/([\\[\]])/g, '\\$1');

/**
 * Rewrites diaspora* mentions into Disbigle's: `@user` (local), `@user@host` (remote). Accounts
 * whose handle the Disbigle syntax cannot express become a markdown link to their profile;
 * unknown people become plain text.
 */
export function convertMentions(
  text: string,
  resolve: (diasporaId: string) => MentionTarget | null,
): string {
  return text.replace(DIASPORA_MENTION, (_m, name: string | undefined, rawId: string) => {
    const id = rawId.toLowerCase();
    const target = resolve(id);
    const [user = '', host = ''] = id.split('@');
    if (target) {
      if (
        MENTIONABLE_USERNAME.test(target.username) &&
        (target.domain === null || MENTIONABLE_DOMAIN.test(target.domain))
      ) {
        return target.domain === null
          ? `@${target.username}`
          : `@${target.username}@${target.domain}`;
      }
      const label = `@${escapeLabel(name?.trim() || id)}`;
      return target.url ? `[${label}](${target.url})` : label;
    }
    if (MENTIONABLE_USERNAME.test(user) && MENTIONABLE_DOMAIN.test(host)) return `@${user}@${host}`;
    return `@${escapeLabel(name?.trim() || id)}`;
  });
}

/** Fallback for polls Disbigle cannot represent (fewer than 2 answers): text with the results. */
export function pollToMarkdown(poll: PollRow): string {
  const total = poll.answers.reduce((sum, a) => sum + a.voteCount, 0);
  const lines = poll.answers.map(
    (a) => `- ${a.answer} (${a.voteCount} ${a.voteCount === 1 ? 'vote' : 'votes'})`,
  );
  return `**${poll.question}**\n\n${lines.join('\n')}${total > 0 ? `\n\n${total} votes in total` : ''}`;
}

/** Same rule as diaspora's `Person.name_from_attrs`. */
export function displayNameOf(profile: ProfileRow | null, fallback: string): string {
  const name = `${profile?.firstName?.trim() ?? ''} ${profile?.lastName?.trim() ?? ''}`.trim();
  return (name || fallback).slice(0, 200);
}

export interface ProfileDetails {
  bio: string;
  fields: { name: string; value: string }[];
}

/**
 * Bio, location, gender and birthday. diaspora* shows them publicly only when the profile is
 * marked public (`public_details`); otherwise only to contacts, which Disbigle cannot express,
 * so they are imported only for public profiles unless `includePrivate` is set.
 */
export function profileDetails(
  profile: ProfileRow | null,
  includePrivate: boolean,
): ProfileDetails {
  if (!profile || (!profile.publicDetails && !includePrivate)) return { bio: '', fields: [] };
  const fields: { name: string; value: string }[] = [];
  if (profile.location?.trim()) fields.push({ name: 'Location', value: profile.location.trim() });
  if (profile.gender?.trim()) fields.push({ name: 'Gender', value: profile.gender.trim() });
  if (profile.birthday) {
    // diaspora* stores the year 1004 (or earlier) when the user leaves it blank.
    const year = Number(profile.birthday.slice(0, 4));
    const value = year <= 1004 ? profile.birthday.slice(5) : profile.birthday;
    fields.push({ name: 'Birthday', value });
  }
  return { bio: (profile.bio ?? '').trim().slice(0, 5000), fields };
}

/** Lowercased `[user, host]` of a diaspora* handle, or null if malformed. */
export function splitHandle(handle: string): { username: string; domain: string } | null {
  const at = handle.lastIndexOf('@');
  if (at <= 0 || at === handle.length - 1) return null;
  return { username: handle.slice(0, at), domain: handle.slice(at + 1).toLowerCase() };
}

/** `en` or `it`, the languages Disbigle ships; anything else becomes `en`. */
export function mapLocale(language: string | null): 'en' | 'it' {
  return language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}
