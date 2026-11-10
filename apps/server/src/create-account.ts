/**
 * Creates a local account that can sign in at once: approved, email confirmed, following the
 * given local accounts. For accounts the admin hands out (the App Store review account).
 * The password is read from NEW_ACCOUNT_PASSWORD, so it stays out of the shell history.
 *
 *   NEW_ACCOUNT_PASSWORD=... pnpm --filter @disbigle/server create-account \
 *     <username> <email> [--name "Display name"] [--bio "..."] [--locale en] [--follow a,b]
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '@disbigle/config';
import {
  type CoreContext,
  findLocalActorByUsername,
  follow,
  MemoryKeyValueStore,
  registerUser,
  updateProfile,
} from '@disbigle/core';
import { createDatabase, schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    bio: { type: 'string' },
    locale: { type: 'string', default: 'en' },
    follow: { type: 'string', default: '' },
  },
});
const [username, email] = positionals;
const password = process.env.NEW_ACCOUNT_PASSWORD;
if (!username || !email || !password) {
  console.error('Usage: NEW_ACCOUNT_PASSWORD=... create-account <username> <email> [options]');
  process.exit(2);
}

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const ctx: CoreContext = { db, config, kv: new MemoryKeyValueStore() };
try {
  const { userId, actorId } = await registerUser(ctx, {
    username,
    email,
    password,
    locale: values.locale as 'en' | 'it' | 'es',
    agreement: true,
  });
  await db
    .update(schema.users)
    .set({ approved: true, emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  if (values.name || values.bio) {
    await updateProfile(ctx, actorId, {
      ...(values.name ? { displayName: values.name } : {}),
      ...(values.bio ? { note: values.bio } : {}),
    });
  }
  for (const other of values.follow.split(',').filter(Boolean)) {
    const target = await findLocalActorByUsername(ctx, other).catch(() => null);
    if (target) await follow(ctx, actorId, target.id);
    else console.warn(`No local account ${other}: not followed`);
  }
  console.log(`Created ${username} (${email}), approved and confirmed.`);
} finally {
  await close();
}
