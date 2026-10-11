import {
  createAspect,
  deleteAspect,
  getRelationships,
  listAspectMembers,
  listAspects,
  renameAspect,
  serializeAccount,
  setAspectMemberships,
} from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { mapList } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import { idParam, int, MastodonError, parseQuery, str } from '../http.ts';
import { readInput } from '../multipart.ts';
import type { Deps } from '../options.ts';
import { idList } from './accounts.ts';

/**
 * Lists are our aspects. Reading a list timeline shows posts by its members, as selecting an
 * aspect does in diaspora*. Unlike a Mastodon list, an aspect is also an audience: posts shared
 * with it from the web client reach its members, so adding someone to a list in an app also lets
 * them see future posts shared with that aspect.
 */
export async function listRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  const owned = async (actorId: string, id: string) => {
    const aspect = (await listAspects(ctx, actorId)).find((a) => a.id === id);
    if (!aspect) throw new MastodonError(404, 'Record not found');
    return aspect;
  };

  app.get('/api/v1/lists', async (request) => {
    const user = requireUser(request, 'read:lists');
    return (await listAspects(ctx, user.actorId)).map(mapList);
  });

  app.get('/api/v1/lists/:id', async (request) => {
    const user = requireUser(request, 'read:lists');
    return mapList(await owned(user.actorId, idParam(request)));
  });

  app.post('/api/v1/lists', async (request) => {
    const user = requireUser(request, 'write:lists');
    const { fields } = await readInput(request);
    const title = str(fields.title)?.trim() ?? '';
    if (!title) throw new MastodonError(422, "Validation failed: Title can't be blank");
    return mapList(await createAspect(ctx, user.actorId, title));
  });

  app.put('/api/v1/lists/:id', async (request) => {
    const user = requireUser(request, 'write:lists');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const title = str(fields.title)?.trim();
    if (!title) return mapList(await owned(user.actorId, id));
    return mapList(await renameAspect(ctx, user.actorId, id, title));
  });

  app.delete('/api/v1/lists/:id', async (request) => {
    const user = requireUser(request, 'write:lists');
    await deleteAspect(ctx, user.actorId, idParam(request));
    return {};
  });

  app.get('/api/v1/lists/:id/accounts', async (request) => {
    const user = requireUser(request, 'read:lists');
    const id = idParam(request);
    const members = await listAspectMembers(ctx, user.actorId, id);
    // `limit=0` means "all" in Mastodon; aspects are small, so we always return every member.
    const limit = int(parseQuery(request).limit);
    const page = limit && limit > 0 ? members.slice(0, Math.min(limit, 80)) : members;
    return new Presenter(ctx, user.actorId).accounts(page.map(serializeAccount));
  });

  const changeMembership = async (
    actorId: string,
    listId: string,
    accountIds: string[],
    add: boolean,
  ) => {
    await owned(actorId, listId);
    const relationships = await getRelationships(ctx, actorId, accountIds);
    for (const rel of relationships) {
      const current = new Set(rel.aspectIds);
      if (add) current.add(listId);
      else current.delete(listId);
      await setAspectMemberships(ctx, actorId, rel.id, [...current]);
    }
  };

  app.post('/api/v1/lists/:id/accounts', async (request) => {
    const user = requireUser(request, 'write:lists');
    const id = idParam(request);
    const { fields } = await readInput(request);
    await changeMembership(user.actorId, id, idList(fields.account_ids, 250), true);
    return {};
  });

  app.delete('/api/v1/lists/:id/accounts', async (request) => {
    const user = requireUser(request, 'write:lists');
    const id = idParam(request);
    const { fields } = await readInput(request);
    const ids = idList(fields.account_ids, 250);
    // Some clients send DELETE parameters in the query string.
    const fromQuery = idList(parseQuery(request).account_ids, 250);
    await changeMembership(user.actorId, id, ids.length > 0 ? ids : fromQuery, false);
    return {};
  });
}
