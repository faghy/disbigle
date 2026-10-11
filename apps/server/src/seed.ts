/**
 * Fills a development database with a few accounts, aspects, follows, posts and a poll, so the
 * web client has something to show. Refuses to run in production.
 *
 *   pnpm --filter @disbigle/server seed
 */
import { loadConfig } from '@disbigle/config';
import {
  type CoreContext,
  createPost,
  findLocalActorByUsername,
  follow,
  like,
  listAspects,
  MemoryKeyValueStore,
  registerUser,
  setAspectMemberships,
  updateProfile,
} from '@disbigle/core';
import { createDatabase } from '@disbigle/db';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const { db, close } = createDatabase(config.DATABASE_URL);
const ctx: CoreContext = { db, config, kv: new MemoryKeyValueStore(), rsaKeyBits: 2048 };
const PASSWORD = 'disbigle-demo';

const people = [
  {
    username: 'alice',
    name: 'Alice',
    bio: 'Fotografa di montagna. Su diaspora* dal 2011.',
    locale: 'it' as const,
  },
  {
    username: 'bruno',
    name: 'Bruno',
    bio: 'Sviluppatore, ciclista, padre di due disbigli.',
    locale: 'it' as const,
  },
  { username: 'carla', name: 'Carla', bio: 'Reading, cooking, federating.', locale: 'en' as const },
];

if (await findLocalActorByUsername(ctx, 'alice')) {
  console.log('Already seeded (alice exists); nothing to do.');
  await close();
  process.exit(0);
}

const ids: Record<string, string> = {};
for (const person of people) {
  const { actorId } = await registerUser(ctx, {
    username: person.username,
    email: `${person.username}@example.com`,
    password: PASSWORD,
    locale: person.locale,
    agreement: true,
  });
  await updateProfile(ctx, actorId, { displayName: person.name, note: person.bio });
  ids[person.username] = actorId;
}
const [alice, bruno, carla] = [ids.alice ?? '', ids.bruno ?? '', ids.carla ?? ''];

await follow(ctx, bruno, alice);
await follow(ctx, carla, alice);
await follow(ctx, alice, bruno);
const [family, friends] = await listAspects(ctx, alice);
await setAspectMemberships(ctx, alice, bruno, [family?.id ?? '']);
await setAspectMemberships(ctx, alice, carla, [friends?.id ?? '']);

const welcome = await createPost(ctx, alice, {
  content:
    'Benvenuti su **Disbigle**! Il social che parla ActivityPub e diaspora*. #disbigle #fediverso',
});
await createPost(ctx, alice, {
  content: 'Solo per la famiglia: domenica pranzo da me 🍝',
  visibility: 'limited',
  aspectIds: [family?.id ?? ''],
});
await createPost(ctx, alice, {
  content: 'Dove andiamo in gita?',
  poll: {
    options: ['Dolomiti', 'Lago di Garda', 'Cinque Terre'],
    expiresIn: 3 * 24 * 3600,
    multiple: false,
  },
});
await createPost(ctx, bruno, {
  content: `Che bello vederti qui @alice! Stamattina 60 km in bici #ciclismo`,
});
await createPost(ctx, carla, {
  content: 'Trying out aspects: it feels like diaspora, but on the whole Fediverse.',
});
await createPost(ctx, bruno, { content: 'Grazie!', inReplyToId: welcome.id });
await like(ctx, bruno, welcome.id);
await like(ctx, carla, welcome.id);

console.log(`Seeded accounts: ${people.map((p) => p.username).join(', ')} (password: ${PASSWORD})`);
await close();
