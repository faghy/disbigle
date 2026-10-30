import { schema, uuidv7 } from '@disbigle/db';
import {
  type CreateGroupRequest,
  createGroupRequestSchema,
  type Group,
  type GroupMember,
  type GroupMemberState,
  type GroupPrivacy,
  type GroupRole,
  type GroupSummary,
  type UpdateGroupRequest,
  updateGroupRequestSchema,
} from '@disbigle/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { reservedUsernames } from '../accounts/register.ts';
import { serializeAccount } from '../accounts/serialize.ts';
import { localActorUrls } from '../accounts/urls.ts';
import { type CoreContext, emit } from '../context.ts';
import { generateActorKeyPair } from '../crypto/keys.ts';
import { diasporaGuid } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import { isBridgeUsername } from '../federation/bridge.ts';
import { createNotification } from './notifications.ts';

const { groups, groupMembers, actors, posts, blocks } = schema;

type GroupRow = typeof groups.$inferSelect;
type ActorRow = typeof actors.$inferSelect;
type MemberRow = typeof groupMembers.$inferSelect;
export interface GroupRecord {
  group: GroupRow;
  actor: ActorRow;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How strict each privacy is: a group can become stricter, never more open. */
const strictness: Record<GroupPrivacy, number> = { public: 0, private: 1, secret: 2 };

/** A group by id or handle (any case), with its actor. */
export async function findGroup(ctx: CoreContext, idOrHandle: string): Promise<GroupRecord | null> {
  const [row] = await ctx.db
    .select({ group: groups, actor: actors })
    .from(groups)
    .innerJoin(actors, eq(actors.id, groups.actorId))
    .where(
      UUID.test(idOrHandle)
        ? or(eq(groups.id, idOrHandle), eq(groups.actorId, idOrHandle))
        : and(sql`lower(${actors.username}) = lower(${idOrHandle})`, isNull(actors.domain)),
    );
  return row ?? null;
}

/** The group whose actor this is, if it is one of ours. */
export async function groupOfActor(ctx: CoreContext, actorId: string): Promise<GroupRecord | null> {
  const [row] = await ctx.db
    .select({ group: groups, actor: actors })
    .from(groups)
    .innerJoin(actors, eq(actors.id, groups.actorId))
    .where(eq(groups.actorId, actorId));
  return row ?? null;
}

async function membershipOf(
  ctx: CoreContext,
  groupId: string,
  actorId: string | null,
): Promise<MemberRow | null> {
  if (!actorId) return null;
  const [row] = await ctx.db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.actorId, actorId)));
  return row ?? null;
}

/** Whether the actor is a full member (not just invited or waiting). */
export async function isGroupMember(
  ctx: CoreContext,
  groupId: string,
  actorId: string,
): Promise<boolean> {
  return (await membershipOf(ctx, groupId, actorId))?.state === 'member';
}

/** Secret groups exist only for their members and the people invited. */
const groupVisibleTo = (group: GroupRow, membership: MemberRow | null) =>
  group.privacy !== 'secret' || membership !== null;

/** Loads a group the viewer may know about, or throws not_found. */
async function requireGroup(
  ctx: CoreContext,
  viewerActorId: string | null,
  idOrHandle: string,
): Promise<GroupRecord & { membership: MemberRow | null }> {
  const record = await findGroup(ctx, idOrHandle);
  const membership = record ? await membershipOf(ctx, record.group.id, viewerActorId) : null;
  if (!record || record.actor.suspendedAt || !groupVisibleTo(record.group, membership))
    throw new DomainError('not_found', 'Group not found');
  return { ...record, membership };
}

const isModerator = (membership: MemberRow | null) =>
  membership?.state === 'member' &&
  (membership.role === 'admin' || membership.role === 'moderator');

const isAdmin = (membership: MemberRow | null) =>
  membership?.state === 'member' && membership.role === 'admin';

export function serializeGroupSummary({ group, actor }: GroupRecord): GroupSummary {
  return {
    id: group.id,
    handle: actor.username,
    name: actor.displayName || actor.username,
    privacy: group.privacy,
    avatarUrl: actor.avatarUrl,
  };
}

/** Group summaries by id, for statuses and notifications. */
export async function groupSummaries(
  ctx: CoreContext,
  groupIds: string[],
): Promise<Map<string, GroupSummary>> {
  if (groupIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ group: groups, actor: actors })
    .from(groups)
    .innerJoin(actors, eq(actors.id, groups.actorId))
    .where(inArray(groups.id, [...new Set(groupIds)]));
  return new Map(rows.map((r) => [r.group.id, serializeGroupSummary(r)]));
}

async function serializeGroups(
  ctx: CoreContext,
  viewerActorId: string | null,
  records: GroupRecord[],
): Promise<Group[]> {
  if (records.length === 0) return [];
  const ids = records.map((r) => r.group.id);
  const [counts, pendingPosts, memberships] = await Promise.all([
    ctx.db
      .select({
        groupId: groupMembers.groupId,
        members: sql<number>`count(*) filter (where ${groupMembers.state} = 'member')::int`,
        requests: sql<number>`count(*) filter (where ${groupMembers.state} = 'requested')::int`,
      })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, ids))
      .groupBy(groupMembers.groupId),
    ctx.db
      .select({ groupId: posts.groupId, n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(inArray(posts.groupId, ids), eq(posts.pendingApproval, true)))
      .groupBy(posts.groupId),
    viewerActorId
      ? ctx.db
          .select()
          .from(groupMembers)
          .where(and(inArray(groupMembers.groupId, ids), eq(groupMembers.actorId, viewerActorId)))
      : Promise.resolve([] as MemberRow[]),
  ]);
  const countById = new Map(counts.map((c) => [c.groupId, c]));
  const pendingById = new Map(pendingPosts.map((c) => [c.groupId, c.n]));
  const membershipById = new Map(memberships.map((m) => [m.groupId, m]));
  return records.map((record) => {
    const { group, actor } = record;
    const membership = membershipById.get(group.id) ?? null;
    const count = countById.get(group.id);
    const result: Group = {
      ...serializeGroupSummary(record),
      description: actor.summary,
      headerUrl: actor.headerUrl,
      url: `${ctx.config.PUBLIC_URL}/groups/${actor.username}`,
      membersCount: count?.members ?? 0,
      createdAt: group.createdAt.toISOString(),
      membership: membership ? { role: membership.role, state: membership.state } : null,
      joinApproval: group.joinApproval,
      postApproval: group.postApproval,
    };
    if (isModerator(membership)) {
      result.requestsCount = count?.requests ?? 0;
      result.pendingPostsCount = pendingById.get(group.id) ?? 0;
    }
    return result;
  });
}

async function serializeGroup(
  ctx: CoreContext,
  viewerActorId: string | null,
  record: GroupRecord,
): Promise<Group> {
  const [group] = await serializeGroups(ctx, viewerActorId, [record]);
  if (!group) throw new Error('Group serialization failed');
  return group;
}

export async function createGroup(
  ctx: CoreContext,
  creatorActorId: string,
  request: CreateGroupRequest,
): Promise<Group> {
  const input = createGroupRequestSchema.parse(request);
  const [creator] = await ctx.db.select().from(actors).where(eq(actors.id, creatorActorId));
  if (!creator || creator.domain !== null || creator.isGroup)
    throw new DomainError('forbidden', 'Only local accounts can create groups');
  const handle = input.handle;
  const taken = () =>
    new DomainError('validation_failed', 'This name is already taken', [
      { path: 'handle', message: 'This name is already taken' },
    ]);
  if (reservedUsernames.has(handle.toLowerCase()) || isBridgeUsername(handle)) throw taken();
  const [existing] = await ctx.db
    .select({ id: actors.id })
    .from(actors)
    .where(and(sql`lower(${actors.username}) = lower(${handle})`, isNull(actors.domain)));
  if (existing) throw taken();

  const keys = await generateActorKeyPair(ctx.rsaKeyBits ?? 4096);
  const actorId = uuidv7();
  const groupId = uuidv7();
  const guid = diasporaGuid();
  const urls = localActorUrls(ctx.config, handle, guid);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(actors).values({
        id: actorId,
        username: handle,
        domain: null,
        displayName: input.name,
        summary: input.description,
        isGroup: true,
        locked: input.privacy !== 'public',
        discoverable: input.privacy !== 'secret',
        publicKeyPem: keys.publicKeyPem,
        // Public groups also appear on diaspora*, as an account that reshares the group's posts.
        protocols: ['activitypub', 'diaspora'],
        diasporaGuid: guid,
        apUri: urls.apUri,
        apUrl: `${ctx.config.PUBLIC_URL}/groups/${handle}`,
        apInbox: urls.apInbox,
        apOutbox: urls.apOutbox,
        apFollowers: urls.apFollowers,
        apSharedInbox: urls.apSharedInbox,
      });
      await tx.insert(groups).values({
        id: groupId,
        actorId,
        privacy: input.privacy,
        privateKeyPem: keys.privateKeyPem,
        createdById: creatorActorId,
      });
      await tx.insert(groupMembers).values({
        groupId,
        actorId: creatorActorId,
        role: 'admin',
        state: 'member',
      });
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause ?? (error as { code?: string });
    if (cause?.code === '23505') throw taken();
    throw error;
  }
  const record = await findGroup(ctx, groupId);
  if (!record) throw new Error('Group vanished after insert');
  return serializeGroup(ctx, creatorActorId, record);
}

export async function getGroup(
  ctx: CoreContext,
  viewerActorId: string | null,
  idOrHandle: string,
): Promise<Group> {
  const record = await requireGroup(ctx, viewerActorId, idOrHandle);
  return serializeGroup(ctx, viewerActorId, record);
}

/** Changes name, description or privacy (admins only; privacy only ever gets stricter). */
export async function updateGroup(
  ctx: CoreContext,
  actorId: string,
  idOrHandle: string,
  request: UpdateGroupRequest,
): Promise<Group> {
  const input = updateGroupRequestSchema.parse(request);
  const record = await requireGroup(ctx, actorId, idOrHandle);
  if (!isAdmin(record.membership))
    throw new DomainError('forbidden', 'Only admins can change the group');
  const { group, actor } = record;
  if (input.privacy && strictness[input.privacy] < strictness[group.privacy]) {
    throw new DomainError('validation_failed', 'A group can only become more private', [
      { path: 'privacy', message: 'A group can only become more private' },
    ]);
  }
  const privacy = input.privacy ?? group.privacy;
  const joinApproval = input.joinApproval ?? group.joinApproval;
  const postApproval = input.postApproval ?? group.postApproval;
  if (joinApproval !== group.joinApproval || postApproval !== group.postApproval) {
    await ctx.db.update(groups).set({ joinApproval, postApproval }).where(eq(groups.id, group.id));
  }
  await ctx.db
    .update(actors)
    .set({
      displayName: input.name ?? actor.displayName,
      summary: input.description ?? actor.summary,
      // Elsewhere on the fediverse, a group that approves its members takes follow requests.
      locked: privacy !== 'public' || joinApproval,
      discoverable: privacy !== 'secret',
      updatedAt: new Date(),
    })
    .where(eq(actors.id, actor.id));
  if (privacy !== group.privacy) {
    await ctx.db.update(groups).set({ privacy }).where(eq(groups.id, group.id));
  }
  if (group.privacy === 'public' && privacy === 'public') {
    // Followers elsewhere get the new name and description.
    await emit(ctx, { type: 'profile.updated', actorId: actor.id });
  } else if (group.privacy === 'public') {
    // Private groups stay on this server: the fediverse is told the group is gone.
    await emit(ctx, { type: 'group.closed', groupId: group.id, actorId: actor.id });
    await ctx.db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.id),
          sql`exists (select 1 from ${actors} where ${actors.id} = ${groupMembers.actorId} and ${actors.domain} is not null)`,
        ),
      );
  }
  return getGroup(ctx, actorId, group.id);
}

/** Deletes the group, its posts and its memberships (admins only). */
export async function deleteGroup(
  ctx: CoreContext,
  actorId: string,
  idOrHandle: string,
): Promise<void> {
  const record = await requireGroup(ctx, actorId, idOrHandle);
  if (!isAdmin(record.membership))
    throw new DomainError('forbidden', 'Only admins can delete the group');
  const { group, actor } = record;
  if (group.privacy === 'public') {
    // Sent while the followers are still known.
    await emit(ctx, { type: 'group.closed', groupId: group.id, actorId: actor.id });
  }
  const { deletePost } = await import('./posts.ts');
  const groupPosts = await ctx.db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.groupId, group.id), isNull(posts.inReplyToId)));
  for (const post of groupPosts) {
    await deletePost(ctx, actorId, post.id, { asModerator: true }).catch(() => undefined);
  }
  // The actor's deletion takes the group, its members and any post left with it.
  await ctx.db.delete(actors).where(eq(actors.id, actor.id));
}

/** Groups the actor belongs to (or was invited to, or asked to join), most recent first. */
export async function listMyGroups(
  ctx: CoreContext,
  actorId: string,
  state: GroupMemberState = 'member',
): Promise<Group[]> {
  const rows = await ctx.db
    .select({ group: groups, actor: actors })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(actors, eq(actors.id, groups.actorId))
    .where(
      and(
        eq(groupMembers.actorId, actorId),
        eq(groupMembers.state, state),
        isNull(actors.suspendedAt),
      ),
    )
    .orderBy(desc(groupMembers.createdAt))
    .limit(200);
  return serializeGroups(ctx, actorId, rows);
}

/** Public and private groups (never secret ones), the busiest first, optionally by name. */
export async function discoverGroups(
  ctx: CoreContext,
  viewerActorId: string | null,
  options: { q?: string; limit?: number } = {},
): Promise<Group[]> {
  const q = options.q?.trim().replace(/^[@!]/, '');
  const term = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await ctx.db
    .select({ group: groups, actor: actors })
    .from(groups)
    .innerJoin(actors, eq(actors.id, groups.actorId))
    .where(
      and(
        ne(groups.privacy, 'secret'),
        isNull(actors.suspendedAt),
        term ? or(ilike(actors.username, term), ilike(actors.displayName, term)) : undefined,
      ),
    )
    .orderBy(
      sql`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${groups.id} and ${groupMembers.state} = 'member') desc`,
      desc(groups.id),
    )
    .limit(Math.min(options.limit ?? 40, 80));
  return serializeGroups(ctx, viewerActorId, rows);
}

async function blockedByAdmins(ctx: CoreContext, groupId: string, actorId: string) {
  const [row] = await ctx.db
    .select({ one: sql`1` })
    .from(blocks)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.actorId, blocks.actorId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, 'admin'),
      ),
    )
    .where(eq(blocks.targetActorId, actorId))
    .limit(1);
  return Boolean(row);
}

export async function notifyModerators(
  ctx: CoreContext,
  groupId: string,
  fromActorId: string,
  type: 'group_request' | 'group_post_pending' = 'group_request',
  postId?: string,
): Promise<void> {
  const moderators = await ctx.db
    .select({ actorId: groupMembers.actorId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.state, 'member'),
        inArray(groupMembers.role, ['admin', 'moderator']),
      ),
    );
  for (const m of moderators) {
    if (m.actorId === fromActorId) continue;
    await createNotification(ctx, {
      actorId: m.actorId,
      type,
      fromActorId,
      groupId,
      ...(postId ? { postId } : {}),
    });
  }
}

/**
 * Joins a group: at once if it is public or you were invited, otherwise as a request the
 * moderators approve. Secret groups take invited people only.
 */
export async function joinGroup(
  ctx: CoreContext,
  actorId: string,
  idOrHandle: string,
): Promise<Group> {
  const record = await requireGroup(ctx, actorId, idOrHandle);
  const { group, membership } = record;
  if (membership?.state === 'member' || membership?.state === 'requested')
    return serializeGroup(ctx, actorId, record);
  if (await blockedByAdmins(ctx, group.id, actorId))
    throw new DomainError('forbidden', 'You cannot join this group');
  if (membership?.state === 'invited' || (group.privacy === 'public' && !group.joinApproval)) {
    await ctx.db
      .insert(groupMembers)
      .values({ groupId: group.id, actorId, state: 'member' })
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.actorId],
        set: { state: 'member', createdAt: new Date() },
      });
  } else if (group.privacy !== 'secret') {
    await ctx.db
      .insert(groupMembers)
      .values({ groupId: group.id, actorId, state: 'requested' })
      .onConflictDoNothing();
    await notifyModerators(ctx, group.id, actorId);
  } else {
    throw new DomainError('forbidden', 'This group takes members by invitation only');
  }
  return getGroup(ctx, actorId, group.id);
}

async function adminCount(ctx: CoreContext, groupId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.role, 'admin'),
        eq(groupMembers.state, 'member'),
      ),
    );
  return row?.n ?? 0;
}

/** Leaves a group, or withdraws a request, or declines an invitation. */
export async function leaveGroup(
  ctx: CoreContext,
  actorId: string,
  idOrHandle: string,
): Promise<void> {
  const record = await requireGroup(ctx, actorId, idOrHandle);
  const { group, membership } = record;
  if (!membership) return;
  if (isAdmin(membership) && (await adminCount(ctx, group.id)) <= 1) {
    throw new DomainError(
      'forbidden',
      'Make someone else admin before leaving, or delete the group',
    );
  }
  await ctx.db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.actorId, actorId)));
  await ctx.db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.groupId, group.id),
        eq(schema.notifications.fromActorId, actorId),
        eq(schema.notifications.type, 'group_request'),
      ),
    );
}

/** Members (or, for moderators, pending requests and invitations), admins first. */
export async function listGroupMembers(
  ctx: CoreContext,
  viewerActorId: string | null,
  idOrHandle: string,
  state: GroupMemberState = 'member',
): Promise<GroupMember[]> {
  const record = await requireGroup(ctx, viewerActorId, idOrHandle);
  const { group, membership } = record;
  if (state !== 'member' && !isModerator(membership))
    throw new DomainError('forbidden', 'Only moderators see requests and invitations');
  if (state === 'member' && group.privacy !== 'public' && membership?.state !== 'member')
    throw new DomainError('forbidden', 'Only members see who is in this group');
  const rows = await ctx.db
    .select({ member: groupMembers, actor: actors })
    .from(groupMembers)
    .innerJoin(actors, eq(actors.id, groupMembers.actorId))
    .where(
      and(
        eq(groupMembers.groupId, group.id),
        eq(groupMembers.state, state),
        isNull(actors.suspendedAt),
      ),
    )
    .orderBy(
      sql`case ${groupMembers.role} when 'admin' then 0 when 'moderator' then 1 else 2 end`,
      asc(groupMembers.createdAt),
    )
    .limit(500);
  return rows.map(({ member, actor }) => ({
    account: serializeAccount(actor),
    role: member.role,
    state: member.state,
    createdAt: member.createdAt.toISOString(),
  }));
}

async function requireModerator(ctx: CoreContext, actorId: string, idOrHandle: string) {
  const record = await requireGroup(ctx, actorId, idOrHandle);
  if (!isModerator(record.membership))
    throw new DomainError('forbidden', 'Only moderators can do this');
  return record;
}

/** Approves or declines a request to join. */
export async function answerGroupRequest(
  ctx: CoreContext,
  moderatorActorId: string,
  idOrHandle: string,
  targetActorId: string,
  accept: boolean,
): Promise<void> {
  const { group } = await requireModerator(ctx, moderatorActorId, idOrHandle);
  const where = and(
    eq(groupMembers.groupId, group.id),
    eq(groupMembers.actorId, targetActorId),
    eq(groupMembers.state, 'requested'),
  );
  const changed = accept
    ? await ctx.db
        .update(groupMembers)
        .set({ state: 'member', createdAt: new Date() })
        .where(where)
        .returning({ actorId: groupMembers.actorId, apUri: groupMembers.apUri })
    : await ctx.db
        .delete(groupMembers)
        .where(where)
        .returning({ actorId: groupMembers.actorId, apUri: groupMembers.apUri });
  if (changed.length === 0) throw new DomainError('not_found', 'Request not found');
  // The other moderators no longer need to look at it.
  await ctx.db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.groupId, group.id),
        eq(schema.notifications.fromActorId, targetActorId),
        eq(schema.notifications.type, 'group_request'),
      ),
    );
  const [target] = await ctx.db.select().from(actors).where(eq(actors.id, targetActorId));
  if (target?.domain) {
    // Someone elsewhere who asked to join: their server hears the answer.
    await emit(
      ctx,
      accept
        ? {
            type: 'group.member_accepted',
            groupId: group.id,
            actorId: targetActorId,
            apUri: changed[0]?.apUri ?? null,
          }
        : {
            type: 'group.member_removed',
            groupId: group.id,
            actorId: targetActorId,
            apUri: changed[0]?.apUri ?? '',
          },
    );
  } else if (accept) {
    await createNotification(ctx, {
      actorId: targetActorId,
      type: 'group_accepted',
      fromActorId: moderatorActorId,
      groupId: group.id,
    });
  }
}

/** Invites a local account; members may invite to public and private groups, moderators to secret ones. */
export async function inviteToGroup(
  ctx: CoreContext,
  inviterActorId: string,
  idOrHandle: string,
  targetActorId: string,
): Promise<void> {
  const record = await requireGroup(ctx, inviterActorId, idOrHandle);
  const { group, membership } = record;
  if (membership?.state !== 'member')
    throw new DomainError('forbidden', 'Only members can invite people');
  if (group.privacy === 'secret' && !isModerator(membership))
    throw new DomainError('forbidden', 'Only moderators can invite people to a secret group');
  const [target] = await ctx.db.select().from(actors).where(eq(actors.id, targetActorId));
  if (!target || target.domain !== null || target.isGroup || target.suspendedAt)
    throw new DomainError('not_found', 'Account not found');
  if (await blockedByAdmins(ctx, group.id, targetActorId))
    throw new DomainError('forbidden', 'This person cannot join the group');
  const existing = await membershipOf(ctx, group.id, targetActorId);
  if (existing?.state === 'member') return;
  if (existing?.state === 'requested') {
    // Inviting someone who asked to join lets them in.
    if (!isModerator(membership))
      throw new DomainError('forbidden', 'A moderator has to approve this request');
    await answerGroupRequest(ctx, inviterActorId, group.id, targetActorId, true);
    return;
  }
  const inserted = await ctx.db
    .insert(groupMembers)
    .values({
      groupId: group.id,
      actorId: targetActorId,
      state: 'invited',
      invitedById: inviterActorId,
    })
    .onConflictDoNothing()
    .returning({ actorId: groupMembers.actorId });
  if (inserted.length > 0) {
    await createNotification(ctx, {
      actorId: targetActorId,
      type: 'group_invite',
      fromActorId: inviterActorId,
      groupId: group.id,
    });
  }
}

/** Makes a member admin, moderator or plain member (admins only). */
export async function setGroupRole(
  ctx: CoreContext,
  adminActorId: string,
  idOrHandle: string,
  targetActorId: string,
  role: GroupRole,
): Promise<void> {
  const record = await requireGroup(ctx, adminActorId, idOrHandle);
  if (!isAdmin(record.membership))
    throw new DomainError('forbidden', 'Only admins can change roles');
  const { group } = record;
  const target = await membershipOf(ctx, group.id, targetActorId);
  if (target?.state !== 'member') throw new DomainError('not_found', 'Member not found');
  const [targetActor] = await ctx.db.select().from(actors).where(eq(actors.id, targetActorId));
  if (role !== 'member' && targetActor?.domain !== null)
    throw new DomainError('forbidden', 'Only people on this server can moderate the group');
  if (target.role === 'admin' && role !== 'admin' && (await adminCount(ctx, group.id)) <= 1)
    throw new DomainError('forbidden', 'A group needs at least one admin');
  await ctx.db
    .update(groupMembers)
    .set({ role })
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.actorId, targetActorId)));
}

/** Removes a member, or withdraws an invitation (moderators; only admins remove moderators). */
export async function removeGroupMember(
  ctx: CoreContext,
  moderatorActorId: string,
  idOrHandle: string,
  targetActorId: string,
): Promise<void> {
  const record = await requireModerator(ctx, moderatorActorId, idOrHandle);
  const { group, membership } = record;
  if (targetActorId === moderatorActorId)
    throw new DomainError('bad_request', 'Leave the group instead');
  const target = await membershipOf(ctx, group.id, targetActorId);
  if (!target) throw new DomainError('not_found', 'Member not found');
  if (target.role !== 'member' && !isAdmin(membership))
    throw new DomainError('forbidden', 'Only admins can remove moderators and admins');
  await ctx.db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.actorId, targetActorId)));
  if (target.apUri) {
    await emit(ctx, {
      type: 'group.member_removed',
      groupId: group.id,
      actorId: targetActorId,
      apUri: target.apUri,
    });
  }
}

/** The group, when the actor administers it (for changing its pictures); throws otherwise. */
export async function requireGroupAdmin(
  ctx: CoreContext,
  actorId: string,
  idOrHandle: string,
): Promise<GroupRecord> {
  const record = await requireGroup(ctx, actorId, idOrHandle);
  if (!isAdmin(record.membership))
    throw new DomainError('forbidden', 'Only admins can change the group');
  return record;
}

/** The group's posts the viewer may read; not_found for secret groups they are not in. */
export async function requireReadableGroup(
  ctx: CoreContext,
  viewerActorId: string | null,
  idOrHandle: string,
): Promise<GroupRecord> {
  return requireGroup(ctx, viewerActorId, idOrHandle);
}

/** Moderators may delete any post written in their group. */
export async function canModerateGroupPost(
  ctx: CoreContext,
  actorId: string,
  groupId: string,
): Promise<boolean> {
  return isModerator(await membershipOf(ctx, groupId, actorId));
}

/**
 * Someone on another server follows a group: they join it if it is public (and federated), or
 * ask to when it approves its members; private and secret groups stay on this server.
 */
export async function remoteJoinGroup(
  ctx: CoreContext,
  groupActorId: string,
  actorId: string,
  apUri: string | null,
): Promise<'member' | 'requested' | false> {
  const record = await groupOfActor(ctx, groupActorId);
  if (record?.group.privacy !== 'public' || record.actor.suspendedAt) return false;
  if (await blockedByAdmins(ctx, record.group.id, actorId)) return false;
  const [current] = await ctx.db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, record.group.id), eq(groupMembers.actorId, actorId)));
  const state = current?.state === 'member' || !record.group.joinApproval ? 'member' : 'requested';
  await ctx.db
    .insert(groupMembers)
    .values({ groupId: record.group.id, actorId, state, apUri })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.actorId],
      set: { state, apUri },
    });
  if (state === 'requested' && current?.state !== 'requested')
    await notifyModerators(ctx, record.group.id, actorId);
  return state;
}

/** Someone on another server unfollows a group. */
export async function remoteLeaveGroup(
  ctx: CoreContext,
  groupActorId: string,
  actorId: string,
): Promise<void> {
  const record = await groupOfActor(ctx, groupActorId);
  if (!record) return;
  await ctx.db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, record.group.id), eq(groupMembers.actorId, actorId)));
}

/** Remote members of a public group, who receive what the group shares. */
export async function remoteGroupMembers(ctx: CoreContext, groupId: string): Promise<ActorRow[]> {
  const rows = await ctx.db
    .select({ actor: actors })
    .from(groupMembers)
    .innerJoin(actors, eq(actors.id, groupMembers.actorId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.state, 'member'),
        sql`${actors.domain} is not null`,
        isNull(actors.suspendedAt),
      ),
    );
  return rows.map((r) => r.actor);
}
