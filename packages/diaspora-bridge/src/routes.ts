// HTTP endpoints of the diaspora* protocol, as a Fastify plugin.
import { isLocalDomain } from '@disbigle/config';
import {
  bridgedAccountByGuid,
  type CoreContext,
  findActorByHandle,
  findPostByGuid,
} from '@disbigle/core';
import {
  buildHCard,
  buildHostMeta,
  buildWebFinger,
  createMagicEnvelope,
  type Entity,
  JRD_CONTENT_TYPE,
  MAGIC_ENV_CONTENT_TYPE,
  normalizeDiasporaId,
  parseDiasporaId,
  serializeEntity,
  signRelayable,
} from '@disbigle/diaspora';
import type { FastifyInstance } from 'fastify';
import {
  actorById,
  deliversViaDiaspora,
  isPublicVisibility,
  localPrivateKey,
  podBaseUrl,
  postById,
  threadRootOf,
} from './actors.ts';
import { DiasporaBridge } from './bridge.ts';
import {
  commentFor,
  localActorByGuid,
  reshareFor,
  signerFor,
  statusMessageFor,
} from './outgoing.ts';

export interface DiasporaRoutesOptions {
  ctx: CoreContext;
  /** Shared with the publisher; created on the fly when omitted. */
  bridge?: DiasporaBridge;
  /**
   * Also serve `/.well-known/webfinger` (diaspora* links only). Leave off when Fedify serves
   * WebFinger, which already includes the hcard and seed_location links.
   */
  webfinger?: boolean;
}

const FETCH_TYPES = new Set(['post', 'status_message', 'reshare', 'comment']);

/** Default avatar when a person has none (hCard requires the three photo URLs). */
export function defaultAvatarUrl(ctx: CoreContext): string {
  return `${ctx.config.PUBLIC_URL}/assets/user/default.png`;
}

/**
 * Registers the diaspora* endpoints:
 * `GET /.well-known/host-meta`, `GET /hcard/users/:guid`, `POST /receive/public`,
 * `POST /receive/users/:guid`, `GET /fetch/:type/:guid` (and optionally WebFinger).
 * Received messages are processed in the background; the sender gets `202 Accepted`.
 */
export async function diasporaRoutes(app: FastifyInstance, options: DiasporaRoutesOptions) {
  const { ctx } = options;
  const bridge = options.bridge ?? new DiasporaBridge({ ctx });
  const base = ctx.config.PUBLIC_URL;

  await app.register(async (scope) => {
    // Envelopes and encrypted JSON are read as raw text.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );

    scope.get('/.well-known/host-meta', async (_request, reply) =>
      reply.type('application/xrd+xml; charset=utf-8').send(buildHostMeta(base)),
    );

    if (options.webfinger) {
      scope.get<{ Querystring: { resource?: string } }>(
        '/.well-known/webfinger',
        async (request, reply) => {
          const resource = normalizeDiasporaId(request.query.resource ?? '');
          let actor = null;
          try {
            const id = parseDiasporaId(resource);
            if (isLocalDomain(ctx.config, id.host)) {
              actor = await findActorByHandle(ctx, id.username, null);
            }
          } catch {
            actor = null;
          }
          if (!actor?.diasporaGuid || actor.suspendedAt) return reply.status(404).send();
          return reply
            .type(JRD_CONTENT_TYPE)
            .header('access-control-allow-origin', '*')
            .send(
              buildWebFinger({
                diasporaId: `${actor.username}@${ctx.config.LOCAL_DOMAIN}`,
                hcardUrl: `${base}/hcard/users/${actor.diasporaGuid}`,
                seedUrl: `${base}/`,
                profileUrl: actor.apUrl ?? `${base}/@${actor.username}`,
                salmonUrl: `${base}/receive/users/${actor.diasporaGuid}`,
              }),
            );
        },
      );
    }

    scope.get<{ Params: { guid: string } }>('/hcard/users/:guid', async (request, reply) => {
      const actor = await localActorByGuid(ctx, request.params.guid);
      if (!actor?.diasporaGuid) {
        // A bridge identity: the remote account's name and picture, our key.
        const bridged = await bridgedAccountByGuid(ctx, request.params.guid);
        if (!bridged) return reply.status(404).send();
        const { bridge: b, actor: remote } = bridged;
        const name = remote.displayName || remote.username;
        const picture = remote.avatarUrl ?? remote.avatarRemoteUrl;
        const avatar = picture ? new URL(picture, base).href : defaultAvatarUrl(ctx);
        return reply.type('text/html; charset=utf-8').send(
          buildHCard({
            guid: b.diasporaGuid,
            nickname: b.username,
            fullName: name.slice(0, 70).replace(/;/g, ','),
            firstName: name.slice(0, 32).replace(/;/g, ','),
            lastName: '',
            publicKey: b.publicKeyPem,
            photoLargeUrl: avatar,
            photoMediumUrl: avatar,
            photoSmallUrl: avatar,
            searchable: false,
          }),
        );
      }
      const name = actor.displayName || actor.username;
      const avatar = actor.avatarUrl ? new URL(actor.avatarUrl, base).href : defaultAvatarUrl(ctx);
      return reply.type('text/html; charset=utf-8').send(
        buildHCard({
          guid: actor.diasporaGuid,
          nickname: actor.username,
          fullName: name.slice(0, 70).replace(/;/g, ','),
          firstName: name.slice(0, 32).replace(/;/g, ','),
          lastName: '',
          publicKey: actor.publicKeyPem,
          photoLargeUrl: avatar,
          photoMediumUrl: avatar,
          photoSmallUrl: avatar,
          searchable: actor.discoverable,
        }),
      );
    });

    scope.post('/receive/public', async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : '';
      if (!body) return reply.status(422).send();
      await bridge.enqueuePublic(body);
      return reply.status(202).send();
    });

    scope.post<{ Params: { guid: string } }>('/receive/users/:guid', async (request, reply) => {
      const body = typeof request.body === 'string' ? request.body : '';
      if (!body) return reply.status(422).send();
      const known = await bridge.enqueuePrivate(request.params.guid, body);
      if (known) return reply.status(202).send();
      // Bridge identities only speak: what is sent to them is accepted and dropped.
      const bridged = await bridgedAccountByGuid(ctx, request.params.guid);
      return reply.status(bridged ? 202 : 404).send();
    });

    scope.get<{ Params: { type: string; guid: string } }>(
      '/fetch/:type/:guid',
      async (request, reply) => {
        const { type, guid } = request.params;
        if (!FETCH_TYPES.has(type)) return reply.status(404).send();
        const post = await findPostByGuid(ctx, guid);
        if (!post || !isPublicVisibility(post.visibility)) return reply.status(404).send();
        const author = await actorById(ctx, post.actorId);
        if (!author || author.suspendedAt) return reply.status(404).send();
        if (!post.local && type === 'comment') {
          // A remote comment on a local thread: serve it as received (its author signature
          // still holds), in an envelope of the local root author, like a relay.
          const stored = await bridge.relayables.get(guid);
          const root = await threadRootOf(ctx, post);
          const rootAuthor = root.local ? await actorById(ctx, root.actorId) : null;
          const rootSigner = rootAuthor ? await signerFor(ctx, rootAuthor) : null;
          if (stored && rootSigner) {
            return reply
              .type(`${MAGIC_ENV_CONTENT_TYPE}; charset=utf-8`)
              .send(createMagicEnvelope(stored.xml, rootSigner.diasporaId, rootSigner.privateKey));
          }
        }
        if (!post.local) {
          // Not ours: point to the owner, as the protocol asks.
          const ownerBase = deliversViaDiaspora(author) ? podBaseUrl(author) : null;
          return ownerBase
            ? reply.redirect(`${ownerBase}fetch/${type}/${guid}`, 302)
            : reply.status(404).send();
        }
        const signer = await signerFor(ctx, author);
        if (!signer) return reply.status(404).send();
        let entity: Entity;
        if (post.reblogOfId) {
          const original = await postById(ctx, post.reblogOfId);
          const originalAuthor = original ? await actorById(ctx, original.actorId) : null;
          if (!original || !originalAuthor) return reply.status(404).send();
          entity = reshareFor(ctx, post, author, original, originalAuthor);
        } else if (post.inReplyToId) {
          const root = await threadRootOf(ctx, post);
          const comment = await commentFor(ctx, post, author, root);
          const key = await localPrivateKey(ctx, author.id);
          if (!key) return reply.status(404).send();
          entity = root.actorId === author.id ? comment : signRelayable(comment, key);
        } else {
          entity = await statusMessageFor(ctx, post, author);
        }
        return reply
          .type(`${MAGIC_ENV_CONTENT_TYPE}; charset=utf-8`)
          .send(createMagicEnvelope(serializeEntity(entity), signer.diasporaId, signer.privateKey));
      },
    );
  });
}
