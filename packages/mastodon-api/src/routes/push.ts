import { getVapidKeys } from '@disbigle/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractToken, requireUser } from '../auth.ts';
import { bool, MastodonError, obj, str } from '../http.ts';
import { readInput } from '../multipart.ts';
import type { Deps } from '../options.ts';
import { mastodonAlerts, nativeAlerts } from '../push/publisher.ts';
import {
  type MastodonPushStore,
  type MastodonPushSubscription,
  type PushPolicy,
  sealToken,
} from '../push/store.ts';

const POLICIES = ['all', 'followed', 'follower', 'none'] as const;

function policyOf(value: string | undefined): PushPolicy | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(POLICIES as readonly string[]).includes(value)) {
    throw new MastodonError(422, 'Validation failed: policy is invalid');
  }
  return value as PushPolicy;
}

/** Push services only: public https endpoints (the URL comes from the client). */
function checkEndpoint(endpoint: string | undefined): string {
  let url: URL;
  try {
    url = new URL(endpoint ?? '');
  } catch {
    throw new MastodonError(422, 'Validation failed: Endpoint is invalid');
  }
  const privateHost =
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.)/i.test(
      url.hostname,
    );
  if (url.protocol !== 'https:' || privateHost || (endpoint ?? '').length > 2048) {
    throw new MastodonError(422, 'Validation failed: Endpoint must be a public https URL');
  }
  return endpoint as string;
}

const KEY_RE = /^[A-Za-z0-9_\-+/=]{8,200}$/;

/**
 * Mastodon Web Push (`/api/v1/push/subscription`): one subscription per access token. Messages
 * are sent by `MastodonPushPublisher` in Mastodon's payload format.
 */
export async function pushRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  const storeOf = (): MastodonPushStore => {
    const store = deps.options.pushStore;
    if (!store) {
      throw new MastodonError(422, 'Validation failed: push notifications are not available');
    }
    return store;
  };

  const tokenOf = (request: FastifyRequest) => {
    const auth = request.mastodonAuth;
    const raw = extractToken(request);
    if (auth.kind !== 'ok' || !raw) throw new MastodonError(401, 'The access token is invalid');
    return { id: auth.token.id, raw };
  };

  const present = async (subscription: MastodonPushSubscription) => ({
    id: subscription.id,
    endpoint: subscription.endpoint,
    standard: subscription.mastodon.standard,
    alerts: mastodonAlerts(subscription.alerts),
    server_key: (await getVapidKeys(ctx)).publicKey,
    policy: subscription.mastodon.policy,
  });

  app.post('/api/v1/push/subscription', async (request) => {
    const user = requireUser(request, 'push');
    const token = tokenOf(request);
    const { fields } = await readInput(request);
    const subscription = obj(fields.subscription);
    const keys = obj(subscription.keys);
    const p256dh = str(keys.p256dh) ?? '';
    const auth = str(keys.auth) ?? '';
    if (!KEY_RE.test(p256dh) || !KEY_RE.test(auth)) {
      throw new MastodonError(422, 'Validation failed: subscription keys are invalid');
    }
    const data = obj(fields.data);
    const alerts = obj(data.alerts);
    const created = await storeOf().replace({
      userId: user.userId,
      tokenId: token.id,
      endpoint: checkEndpoint(str(subscription.endpoint)),
      p256dh,
      auth,
      alerts: nativeAlerts(
        Object.fromEntries(Object.keys(alerts).map((k) => [k, bool(alerts[k])])),
      ),
      mastodon: {
        policy: policyOf(str(data.policy)) ?? 'all',
        standard: bool(subscription.standard) ?? false,
        sealedToken: sealToken(ctx.config.SESSION_SECRET, token.raw),
      },
    });
    return present(created);
  });

  app.get('/api/v1/push/subscription', async (request) => {
    requireUser(request, 'push');
    const found = deps.options.pushStore
      ? await deps.options.pushStore.findByToken(tokenOf(request).id)
      : null;
    if (!found) throw new MastodonError(404, 'Record not found');
    return present(found);
  });

  app.put('/api/v1/push/subscription', async (request) => {
    requireUser(request, 'push');
    const token = tokenOf(request);
    const { fields } = await readInput(request);
    const data = obj(fields.data);
    const alerts = obj(data.alerts);
    // As in Mastodon, the data sent replaces the previous data.
    const updated = await storeOf().update(token.id, {
      alerts: nativeAlerts(
        Object.fromEntries(Object.keys(alerts).map((k) => [k, bool(alerts[k])])),
      ),
      policy: policyOf(str(data.policy)) ?? 'all',
    });
    if (!updated) throw new MastodonError(404, 'Record not found');
    return present(updated);
  });

  app.delete('/api/v1/push/subscription', async (request) => {
    requireUser(request, 'push');
    await deps.options.pushStore?.deleteByToken(tokenOf(request).id);
    return {};
  });
}
