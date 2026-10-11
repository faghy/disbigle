import type { BridgedAccount, CoreContext, RemoteActorData, RemotePostData } from '@disbigle/core';
import { findActorByApUri, findPostByUri, mediaUrl } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Visibility } from '@disbigle/shared';
import type { Context } from '@fedify/fedify';
import { exportSpki } from '@fedify/fedify';
import {
  type Actor,
  Application,
  Collection,
  Document,
  Endpoints,
  Hashtag,
  Image,
  type Link,
  Mention,
  Note,
  Person,
  PropertyValue,
  PUBLIC_COLLECTION,
  Question,
  Service,
} from '@fedify/vocab';
import { and, asc, eq } from 'drizzle-orm';

type ActorRow = typeof schema.actors.$inferSelect;
type PostRow = typeof schema.posts.$inferSelect;

const instant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Local bios are plain text; ActivityPub expects HTML. */
export function bioToHtml(text: string): string {
  if (!text.trim()) return '';
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** The ActivityPub representation of a local account. */
export async function localActorToPerson(
  ctx: Context<CoreContext>,
  actor: ActorRow,
  keys: Awaited<ReturnType<Context<CoreContext>['getActorKeyPairs']>>,
  movedToUri: string | null = null,
): Promise<Person | Service> {
  const values = {
    id: ctx.getActorUri(actor.username),
    preferredUsername: actor.username,
    name: actor.displayName || actor.username,
    summary: bioToHtml(actor.summary),
    url: actor.apUrl ? new URL(actor.apUrl) : null,
    inbox: ctx.getInboxUri(actor.username),
    outbox: ctx.getOutboxUri(actor.username),
    followers: ctx.getFollowersUri(actor.username),
    following: ctx.getFollowingUri(actor.username),
    featured: ctx.getFeaturedUri(actor.username),
    endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
    publicKey: keys[0]?.cryptographicKey ?? null,
    assertionMethods: keys.map((k) => k.multikey),
    manuallyApprovesFollowers: actor.locked,
    discoverable: actor.discoverable,
    indexable: actor.discoverable,
    published: instant(actor.createdAt),
    icon: actor.avatarUrl ? new Image({ url: new URL(actor.avatarUrl) }) : null,
    image: actor.headerUrl ? new Image({ url: new URL(actor.headerUrl) }) : null,
    attachments: actor.fields.map(
      (f) => new PropertyValue({ name: f.name, value: escapeHtml(f.value) }),
    ),
    aliases: actor.alsoKnownAs.map((uri) => new URL(uri)),
    successor: movedToUri ? new URL(movedToUri) : null,
  };
  return actor.bot ? new Service(values) : new Person(values);
}

/** Where people can see a remote account on its own server. */
export function remoteProfileUrl(actor: ActorRow): string | null {
  if (actor.apUrl) return actor.apUrl;
  if (actor.apUri) return actor.apUri;
  if (actor.domain && actor.diasporaGuid)
    return `https://${actor.domain}/people/${actor.diasporaGuid}`;
  return null;
}

/**
 * The ActivityPub face of a bridge identity: the remote account's name and picture, our key, and
 * a bio that says plainly what it is.
 */
export function bridgedPerson(
  ctx: Context<CoreContext>,
  { bridge, actor }: BridgedAccount,
  keys: Awaited<ReturnType<Context<CoreContext>['getActorKeyPairs']>>,
): Person {
  const handle = `${actor.username}@${actor.domain}`;
  const profile = remoteProfileUrl(actor);
  const network = actor.protocols.includes('activitypub') ? 'the fediverse' : 'diaspora*';
  const link = profile
    ? `<a href="${escapeHtml(profile)}">${escapeHtml(handle)}</a>`
    : escapeHtml(handle);
  const avatar = actor.avatarUrl ?? actor.avatarRemoteUrl;
  return new Person({
    id: ctx.getActorUri(bridge.username),
    preferredUsername: bridge.username,
    name: actor.displayName || actor.username,
    summary: `<p>Bridge account for ${link} on ${network}, run by ${escapeHtml(ctx.data.config.LOCAL_DOMAIN)}. It brings their comments on posts from this server to people on other networks.</p>`,
    url: profile ? new URL(profile) : null,
    inbox: ctx.getInboxUri(bridge.username),
    endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
    publicKey: keys[0]?.cryptographicKey ?? null,
    manuallyApprovesFollowers: true,
    discoverable: false,
    indexable: false,
    icon: avatar ? new Image({ url: new URL(avatar, ctx.data.config.PUBLIC_URL) }) : null,
  });
}

/**
 * A reply written on another network, as a Note from its author's bridge identity. Public, and
 * addressed to the followers of the thread's (local) author, who relays it.
 */
export function bridgedNote(
  ctx: Context<CoreContext>,
  post: PostRow,
  bridge: { username: string },
  inReplyTo: string | null,
  extraCc: URL[],
): Note {
  return new Note({
    id: new URL(post.apUri ?? ''),
    attribution: ctx.getActorUri(bridge.username),
    content: post.contentHtml,
    ...(post.summary ? { summary: post.summary } : {}),
    sensitive: post.sensitive,
    replyTarget: inReplyTo ? new URL(inReplyTo) : null,
    to: PUBLIC_COLLECTION,
    ccs: extraCc,
    published: instant(post.createdAt),
    url: new URL(post.apUri ?? ''),
  });
}

/** Audience fields for a post, following Mastodon's conventions so other servers display it right. */
export async function addressing(
  ctx: Context<CoreContext>,
  post: Pick<PostRow, 'id' | 'visibility'>,
  author: ActorRow,
  only?: ActorRow,
): Promise<{ to: URL[]; cc: URL[]; explicitRecipients: ActorRow[] }> {
  const followers = ctx.getFollowersUri(author.username);
  const explicit = await ctx.data.db
    .select({ actor: schema.actors })
    .from(schema.postAudiences)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.postAudiences.actorId))
    .where(eq(schema.postAudiences.postId, post.id));
  const recipients = explicit.map((r) => r.actor);
  // A limited (aspect) post names only the server's own recipient, so members of an aspect never
  // learn who else is in it.
  const named = only && post.visibility === 'limited' ? [only] : recipients;
  const uris = named
    .map((a) => a.apUri)
    .filter((u): u is string => !!u)
    .map((u) => new URL(u));
  switch (post.visibility) {
    case 'public':
      return { to: [PUBLIC_COLLECTION], cc: [followers, ...uris], explicitRecipients: recipients };
    case 'unlisted':
      return { to: [followers], cc: [PUBLIC_COLLECTION, ...uris], explicitRecipients: recipients };
    case 'followers':
      return { to: [followers], cc: uris, explicitRecipients: recipients };
    default:
      return { to: uris, cc: [], explicitRecipients: recipients };
  }
}

/** Builds the Note for a local post. */
export async function postToNote(
  ctx: Context<CoreContext>,
  post: PostRow,
  author: ActorRow,
  only?: ActorRow,
): Promise<Note | Question> {
  const db = ctx.data.db;
  const { to, cc } = await addressing(ctx, post, author, only);
  const [mentionRows, tagRows, mediaRows, parent] = await Promise.all([
    db
      .select({ actor: schema.actors })
      .from(schema.mentions)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.mentions.actorId))
      .where(eq(schema.mentions.postId, post.id)),
    db
      .select({ name: schema.tags.name })
      .from(schema.postTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.postTags.tagId))
      .where(eq(schema.postTags.postId, post.id)),
    db
      .select()
      .from(schema.mediaAttachments)
      .where(eq(schema.mediaAttachments.postId, post.id))
      .orderBy(asc(schema.mediaAttachments.position)),
    post.inReplyToId
      ? db
          .select({ apUri: schema.posts.apUri })
          .from(schema.posts)
          .where(eq(schema.posts.id, post.inReplyToId))
      : Promise.resolve([]),
  ]);
  const localDomain = ctx.data.config.LOCAL_DOMAIN;
  const tags: (Mention | Hashtag)[] = [
    ...mentionRows
      .filter((m) => m.actor.apUri)
      .map(
        (m) =>
          new Mention({
            href: new URL(m.actor.apUri ?? ''),
            name: `@${m.actor.username}@${m.actor.domain ?? localDomain}`,
          }),
      ),
    ...tagRows.map(
      (t) =>
        new Hashtag({
          href: new URL(`${ctx.data.config.PUBLIC_URL}/tags/${encodeURIComponent(t.name)}`),
          name: `#${t.name}`,
        }),
    ),
  ];
  const replyTarget = parent[0]?.apUri ?? post.inReplyToUri;
  const [poll] = await db.select().from(schema.polls).where(eq(schema.polls.postId, post.id));
  const values = {
    id: new URL(post.apUri ?? ''),
    attribution: ctx.getActorUri(author.username),
    content: post.contentHtml,
    source: undefined,
    summary: post.summary || null,
    sensitive: post.sensitive,
    published: instant(post.createdAt),
    updated: post.editedAt ? instant(post.editedAt) : null,
    url: post.apUrl ? new URL(post.apUrl) : null,
    replyTarget: replyTarget ? new URL(replyTarget) : null,
    tos: to,
    ccs: cc,
    tags,
    attachments: mediaRows
      .filter((m) => m.filePath)
      .map(
        (m) =>
          new Document({
            url: new URL(mediaUrl(ctx.data, m.filePath ?? '')),
            mediaType: m.mimeType,
            name: m.description || null,
            width: m.width,
            height: m.height,
          }),
      ),
  };
  if (!poll) return new Note(values);
  // A post with a poll is an ActivityPub Question; options are Notes with a vote count.
  const optionNotes = poll.options.map(
    (o) => new Note({ name: o.title, replies: new Collection({ totalItems: o.votesCount }) }),
  );
  const ended = poll.expiresAt !== null && poll.expiresAt.getTime() <= Date.now();
  return new Question({
    ...values,
    ...(poll.multiple ? { inclusiveOptions: optionNotes } : { exclusiveOptions: optionNotes }),
    endTime: poll.expiresAt ? instant(poll.expiresAt) : null,
    closed: ended && poll.expiresAt ? instant(poll.expiresAt) : null,
    voters: poll.votersCount,
  });
}

function hrefOf(value: URL | Link | null | undefined): string | null {
  if (!value) return null;
  return value instanceof URL ? value.href : (value.href?.href ?? null);
}

/** Extracts what Disbigle stores about a remote ActivityPub actor. */
export async function remoteActorData(
  ctx: Context<CoreContext>,
  actor: Actor,
): Promise<RemoteActorData | null> {
  if (!actor.id || !actor.preferredUsername || !actor.inboxId) return null;
  const key = await actor.getPublicKey(ctx);
  if (!key?.publicKey) return null;
  const [icon, image] = await Promise.all([actor.getIcon(ctx), actor.getImage(ctx)]);
  const fields: { name: string; value: string }[] = [];
  for await (const attachment of actor.getAttachments(ctx)) {
    if (attachment instanceof PropertyValue && attachment.name && attachment.value) {
      fields.push({ name: attachment.name.toString(), value: attachment.value.toString() });
    }
  }
  const url = actor.url;
  return {
    username: actor.preferredUsername.toString(),
    domain: actor.id.host,
    displayName: actor.name?.toString() ?? actor.preferredUsername.toString(),
    summaryHtml: actor.summary?.toString() ?? '',
    avatarUrl: hrefOf(icon?.url as URL | Link | null | undefined),
    headerUrl: hrefOf(image?.url as URL | Link | null | undefined),
    fields,
    locked: actor.manuallyApprovesFollowers ?? false,
    bot: actor instanceof Service || actor instanceof Application,
    discoverable: actor.discoverable ?? true,
    publicKeyPem: await exportSpki(key.publicKey),
    apUri: actor.id.href,
    apUrl: hrefOf(url as URL | Link | null) ?? actor.id.href,
    apInbox: actor.inboxId.href,
    apSharedInbox: actor.endpoints?.sharedInbox?.href ?? null,
    apOutbox: actor.outboxId?.href ?? null,
    apFollowers: actor.followersId?.href ?? null,
    alsoKnownAs: actor.aliasIds.map((u) => u.href),
    protocol: 'activitypub',
  };
}

/** Maps a local actor URI (ours) back to its actor row. */
async function localActorFromUri(ctx: Context<CoreContext>, uri: URL): Promise<ActorRow | null> {
  const parsed = ctx.parseUri(uri);
  if (parsed?.type !== 'actor') return null;
  const [actor] = await ctx.data.db
    .select()
    .from(schema.actors)
    .where(and(eq(schema.actors.username, parsed.identifier)));
  return actor && actor.domain === null ? actor : null;
}

/** Converts an incoming Note into the protocol-neutral form the core stores. */
export async function noteToPostData(
  ctx: Context<CoreContext>,
  note: Note | Question,
  author: ActorRow,
): Promise<RemotePostData | null> {
  if (!note.id) return null;
  const recipients = [...note.toIds, ...note.ccIds, ...note.btoIds, ...note.bccIds];
  const toHrefs = new Set(note.toIds.map((u) => u.href));
  const ccHrefs = new Set(note.ccIds.map((u) => u.href));
  const followers = author.apFollowers;
  let visibility: Visibility;
  if (toHrefs.has(PUBLIC_COLLECTION.href)) visibility = 'public';
  else if (ccHrefs.has(PUBLIC_COLLECTION.href)) visibility = 'unlisted';
  else if (followers && (toHrefs.has(followers) || ccHrefs.has(followers)))
    visibility = 'followers';
  else visibility = 'direct';

  const audience = new Set<string>();
  for (const uri of recipients) {
    const local = await localActorFromUri(ctx, uri);
    if (local) audience.add(local.id);
    else if (uri.href !== PUBLIC_COLLECTION.href && uri.href !== followers) {
      const known = await findActorByApUri(ctx.data, uri.href);
      if (known) audience.add(known.id);
    }
  }

  const mentionIds = new Set<string>();
  const tagNames: string[] = [];
  for await (const tag of note.getTags(ctx)) {
    if (tag instanceof Mention && tag.href) {
      const local = await localActorFromUri(ctx, tag.href);
      const actor = local ?? (await findActorByApUri(ctx.data, tag.href.href));
      if (actor) mentionIds.add(actor.id);
    } else if (tag instanceof Hashtag && tag.name) {
      tagNames.push(tag.name.toString());
    }
  }
  // A non-public post addressed to people who are not all mentioned is a "limited" post.
  if (visibility === 'direct' && [...audience].some((id) => !mentionIds.has(id)))
    visibility = 'limited';

  const attachments: RemotePostData['attachments'] = [];
  for await (const attachment of note.getAttachments(ctx)) {
    if (!(attachment instanceof Document) && !(attachment instanceof Image)) continue;
    const url = hrefOf(attachment.url as URL | Link | null);
    if (!url) continue;
    attachments.push({
      url,
      mimeType: attachment.mediaType ?? 'application/octet-stream',
      description: attachment.name?.toString() ?? '',
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    });
  }

  const replyUri = note.replyTargetId?.href ?? null;
  const replyPostId = replyUri ? ((await findPostByUri(ctx.data, replyUri))?.id ?? null) : null;

  return {
    authorActorId: author.id,
    apUri: note.id.href,
    apUrl: hrefOf(note.url as URL | Link | null) ?? note.id.href,
    contentHtml: note.content?.toString() ?? '',
    summary: note.summary?.toString() ?? '',
    sensitive: note.sensitive ?? false,
    visibility,
    audienceActorIds: [...audience],
    mentionActorIds: [...mentionIds],
    tags: tagNames,
    inReplyTo: { postId: replyPostId, uri: replyUri },
    attachments,
    publishedAt: note.published ? new Date(note.published.epochMilliseconds) : new Date(),
    ...(note instanceof Question ? { poll: await questionPoll(ctx, note) } : {}),
  };
}

/** Options and totals of an incoming Question. */
export async function questionPoll(ctx: Context<CoreContext>, question: Question) {
  const options: { title: string; votesCount: number }[] = [];
  let multiple = false;
  const read = async (iterable: AsyncIterable<unknown>) => {
    for await (const option of iterable) {
      if (!(option instanceof Note) || !option.name) continue;
      const replies = await option.getReplies(ctx).catch(() => null);
      options.push({ title: option.name.toString(), votesCount: replies?.totalItems ?? 0 });
    }
  };
  await read(question.getExclusiveOptions(ctx));
  if (options.length === 0) {
    multiple = true;
    await read(question.getInclusiveOptions(ctx));
  }
  const end =
    question.endTime ?? (question.closed instanceof Temporal.Instant ? question.closed : null);
  return {
    options,
    multiple,
    expiresAt: end ? new Date(end.epochMilliseconds) : null,
    votersCount: question.voters ?? undefined,
  };
}
