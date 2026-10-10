// Builds a small but realistic diaspora* pod in a fresh PostgreSQL database.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { DEFAULT_DIASPORA_PEPPER } from '../src/index.ts';

export const POD_DOMAIN = 'diaspo.test';

const baseUrl = () =>
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';

/** Ruby's OpenSSL key formats: PKCS#1 private key, SPKI or PKCS#1 public key. */
function rubyKeyPair(publicFormat: 'spki' | 'pkcs1') {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  return {
    privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: publicFormat, format: 'pem' }).toString(),
    spki: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** A Devise hash as diaspora* stores it (`$2a$`, password + pepper). */
export function deviseHash(password: string): string {
  return bcrypt.hashSync(`${password}${DEFAULT_DIASPORA_PEPPER}`, 4).replace(/^\$2b\$/, '$2a$');
}

const guid = () => randomBytes(8).toString('hex');
const postGuid = () => randomBytes(16).toString('hex');

export const PASSWORDS = { alice: 'alice-secret-password', bob: 'bob-secret-password' };

export interface Pod {
  url: string;
  uploadsDir: string;
  keys: Record<'alice' | 'bob' | 'carol' | 'dave', ReturnType<typeof rubyKeyPair>>;
  guids: {
    people: Record<'alice' | 'bob' | 'carol' | 'dave', string>;
    posts: Record<'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'reshare' | 'poll', string>;
    comments: Record<'c1' | 'c2' | 'c3', string>;
    conversation: string;
    messages: Record<'m1' | 'm2', string>;
  };
  times: { p1: Date };
  drop: () => Promise<void>;
}

export async function createDiasporaPod(): Promise<Pod> {
  const name = `diaspora_source_${randomBytes(6).toString('hex')}`;
  const admin = new URL(baseUrl());
  admin.pathname = '/postgres';
  const adminClient = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await adminClient.unsafe(`create database "${name}"`);
  const url = new URL(baseUrl());
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await sql.unsafe(
    await readFile(new URL('./fixtures/diaspora-schema.sql', import.meta.url), 'utf8'),
  );

  const keys = {
    alice: rubyKeyPair('spki'),
    bob: rubyKeyPair('pkcs1'),
    carol: rubyKeyPair('spki'),
    dave: rubyKeyPair('spki'),
  };
  const people = { alice: guid(), bob: guid(), carol: guid(), dave: guid() };
  const posts = {
    p1: postGuid(),
    p2: postGuid(),
    p3: postGuid(),
    p4: postGuid(),
    p5: postGuid(),
    reshare: postGuid(),
    poll: postGuid(),
  };
  const comments = { c1: postGuid(), c2: postGuid(), c3: postGuid() };
  const conversation = postGuid();
  const messages = { m1: postGuid(), m2: postGuid() };
  // diaspora* writes UTC into `timestamp without time zone`; ISO with Z keeps postgres.js from
  // reading these strings as local time.
  const t = (s: string) => `${s.replace(' ', 'T')}Z`;
  const now = t('2024-01-01 00:00:00');

  // Pods of the remote people.
  await sql`insert into pods (id, host, ssl, port, created_at, updated_at) values
    (1, 'remote.example', true, null, ${now}, ${now}),
    (2, 'other.example', false, 3000, ${now}, ${now})`;

  // People: 1 alice and 2 bob are local, 3 carol and 4 dave remote.
  await sql`insert into people (id, guid, diaspora_handle, serialized_public_key, owner_id, created_at, updated_at, pod_id) values
    (1, ${people.alice}, ${`alice@${POD_DOMAIN}`}, ${keys.alice.publicPem}, 1, ${t('2015-03-01 10:00:00')}, ${now}, null),
    (2, ${people.bob}, ${`bob@${POD_DOMAIN}`}, ${keys.bob.publicPem}, 2, ${t('2016-05-02 11:00:00')}, ${now}, null),
    (3, ${people.carol}, 'carol@remote.example', ${keys.carol.publicPem}, null, ${t('2017-01-01 00:00:00')}, ${now}, 1),
    (4, ${people.dave}, 'dave@other.example', ${keys.dave.publicPem}, null, ${t('2018-01-01 00:00:00')}, ${now}, 2)`;
  await sql`insert into users (id, username, serialized_private_key, language, email, encrypted_password, created_at, updated_at, last_sign_in_at) values
    (1, 'alice', ${keys.alice.privatePem}, 'it', 'alice@example.org', ${deviseHash(PASSWORDS.alice)}, ${t('2015-03-01 10:00:00')}, ${now}, ${t('2023-12-24 18:00:00')}),
    (2, 'bob', ${keys.bob.privatePem}, 'de', 'bob@example.org', ${deviseHash(PASSWORDS.bob)}, ${t('2016-05-02 11:00:00')}, ${now}, null)`;
  await sql`insert into profiles (person_id, first_name, last_name, image_url, bio, location, birthday, gender, searchable, nsfw, public_details, created_at, updated_at) values
    (1, 'Alice', 'Rossi', ${`https://${POD_DOMAIN}/uploads/images/thumb_large_avatara.jpg`}, 'Amo *diaspora*', 'Roma', '1004-07-15', null, true, false, true, ${now}, ${now}),
    (2, 'Bob', null, null, 'Private bio', 'Milano', null, null, false, false, false, ${now}, ${now}),
    (3, 'Carol', 'Remote', 'https://remote.example/uploads/images/thumb_large_carol.jpg', 'Hi', null, null, null, true, false, true, ${now}, ${now}),
    (4, null, null, '/uploads/images/thumb_large_dave.jpg', null, null, null, null, true, false, false, ${now}, ${now})`;
  await sql`insert into roles (person_id, name, created_at, updated_at) values (1, 'admin', ${now}, ${now}), (1, 'spotlight', ${now}, ${now})`;

  // Aspects: alice has Famiglia (1) and Amici (2), bob has Friends (3).
  await sql`insert into aspects (id, name, user_id, order_id, created_at, updated_at) values
    (1, 'Famiglia', 1, 1, ${now}, ${now}), (2, 'Amici', 1, 2, ${now}, ${now}), (3, 'Friends', 2, null, ${now}, ${now})`;
  // Contacts (user, person, sharing, receiving):
  //  1 alice–carol mutual, carol in Amici
  //  2 alice–bob: alice shares with bob (receiving), bob in Famiglia
  //  3 bob–alice: alice shares with bob as seen by bob (sharing)
  //  4 bob–dave: dave shares with bob
  //  5 alice–dave: alice shares with dave, dave in Famiglia
  await sql`insert into contacts (id, user_id, person_id, sharing, receiving, created_at, updated_at) values
    (1, 1, 3, true, true, ${now}, ${now}),
    (2, 1, 2, false, true, ${now}, ${now}),
    (3, 2, 1, true, false, ${now}, ${now}),
    (4, 2, 4, true, false, ${now}, ${now}),
    (5, 1, 4, false, true, ${now}, ${now})`;
  await sql`insert into aspect_memberships (aspect_id, contact_id, created_at, updated_at) values
    (2, 1, ${now}, ${now}), (1, 2, ${now}, ${now}), (1, 5, ${now}, ${now})`;

  // Posts.
  const p1Text = `Ciao @{Carol Remote; carol@remote.example} e @{Bob; bob@${POD_DOMAIN}}! #Diaspora\n\n*benvenuti*`;
  await sql`insert into posts (id, author_id, public, guid, type, text, root_guid, created_at, updated_at) values
    (1, 1, true, ${posts.p1}, 'StatusMessage', ${p1Text}, null, ${t('2020-06-01 12:00:00')}, ${now}),
    (2, 1, false, ${posts.p2}, 'StatusMessage', 'Solo per gli amici', null, ${t('2020-06-02 12:00:00')}, ${now}),
    (3, 1, false, ${posts.p3}, 'StatusMessage', 'Per la famiglia', null, ${t('2020-06-03 12:00:00')}, ${now}),
    (4, 3, true, ${posts.p4}, 'StatusMessage', 'Carol public post with a picture', null, ${t('2020-06-04 12:00:00')}, ${now}),
    (5, 3, false, ${posts.p5}, 'StatusMessage', 'Carol private note for bob', null, ${t('2020-06-05 12:00:00')}, ${now}),
    (6, 2, true, ${posts.reshare}, 'Reshare', null, ${posts.p1}, ${t('2020-06-06 12:00:00')}, ${now}),
    (7, 1, true, ${posts.poll}, 'StatusMessage', 'Che ne dite?', null, ${t('2020-06-07 12:00:00')}, ${now})`;
  await sql`insert into photos (author_id, public, guid, remote_photo_path, remote_photo_name, random_string, unprocessed_image, status_message_guid, width, height, text, created_at, updated_at) values
    (1, true, ${postGuid()}, ${`https://${POD_DOMAIN}/uploads/images/`}, 'abc123.jpg', 'abc123', 'abc123.jpg', ${posts.p1}, 800, 600, 'Il Colosseo', ${now}, ${now}),
    (3, true, ${postGuid()}, 'https://remote.example/uploads/images/', 'carolpic.png', null, null, ${posts.p4}, 640, 480, null, ${now}, ${now}),
    (1, false, ${postGuid()}, ${`https://${POD_DOMAIN}/uploads/images/`}, 'missing1.jpg', 'missing1', 'missing1.jpg', ${posts.p3}, null, null, null, ${now}, ${now})`;
  await sql`insert into polls (id, question, status_message_id, status, guid, created_at, updated_at) values (1, 'Pizza o pasta?', 7, true, ${postGuid()}, ${now}, ${now})`;
  await sql`insert into poll_answers (answer, poll_id, guid, vote_count) values ('Pizza', 1, ${postGuid()}, 3), ('Pasta', 1, ${postGuid()}, 1)`;
  await sql`insert into aspect_visibilities (shareable_id, aspect_id, shareable_type) values (2, 2, 'Post'), (3, 1, 'Post')`;
  // Local users who received private posts: bob got alice's family post and carol's note.
  await sql`insert into share_visibilities (shareable_id, user_id, shareable_type) values (3, 2, 'Post'), (5, 2, 'Post')`;
  await sql`insert into mentions (mentions_container_id, person_id, mentions_container_type) values (1, 3, 'Post'), (1, 2, 'Post')`;
  await sql`insert into tags (id, name) values (1, 'diaspora')`;
  await sql`insert into taggings (tag_id, taggable_id, taggable_type, context, created_at) values (1, 1, 'Post', 'tags', ${now})`;

  // Comments: carol on p1 (public), bob on p3 (family), dave on p4.
  await sql`insert into comments (id, text, commentable_id, author_id, guid, created_at, updated_at, commentable_type) values
    (1, 'Bello!', 1, 3, ${comments.c1}, ${t('2020-06-01 13:00:00')}, ${now}, 'Post'),
    (2, 'Grazie mamma', 3, 2, ${comments.c2}, ${t('2020-06-03 13:00:00')}, ${now}, 'Post'),
    (3, 'Nice', 4, 4, ${comments.c3}, ${t('2020-06-04 13:00:00')}, ${now}, 'Post')`;
  // Likes: bob and carol like p1, dave dislikes it (not imported), alice likes carol's comment.
  await sql`insert into likes (positive, target_id, author_id, guid, target_type, created_at, updated_at) values
    (true, 1, 2, ${postGuid()}, 'Post', ${t('2020-06-01 14:00:00')}, ${now}),
    (true, 1, 3, ${postGuid()}, 'Post', ${t('2020-06-01 15:00:00')}, ${now}),
    (false, 1, 4, ${postGuid()}, 'Post', ${t('2020-06-01 16:00:00')}, ${now}),
    (true, 1, 1, ${postGuid()}, 'Comment', ${t('2020-06-01 17:00:00')}, ${now})`;

  // A conversation started by alice with bob and carol.
  await sql`insert into conversations (id, subject, guid, author_id, created_at, updated_at) values (1, 'Cena', ${conversation}, 1, ${t('2021-02-01 19:00:00')}, ${now})`;
  await sql`insert into conversation_visibilities (conversation_id, person_id, created_at, updated_at) values (1, 1, ${now}, ${now}), (1, 2, ${now}, ${now}), (1, 3, ${now}, ${now})`;
  await sql`insert into messages (conversation_id, author_id, guid, text, created_at, updated_at) values
    (1, 1, ${messages.m1}, 'Venite sabato?', ${t('2021-02-01 19:00:00')}, ${now}),
    (1, 2, ${messages.m2}, ${`Sì, @{Alice; alice@${POD_DOMAIN}}!`}, ${t('2021-02-01 20:00:00')}, ${now})`;
  await sql.end();

  // Uploaded files, as CarrierWave stores them.
  const uploadsDir = await mkdtemp(join(tmpdir(), 'diaspora-uploads-'));
  await mkdir(join(uploadsDir, 'images'), { recursive: true });
  for (const file of ['abc123.jpg', 'scaled_full_abc123.jpg', 'thumb_small_abc123.jpg']) {
    await writeFile(join(uploadsDir, 'images', file), `image ${file}`);
  }
  await writeFile(join(uploadsDir, 'images', 'thumb_large_avatara.jpg'), 'avatar of alice');

  return {
    url: url.toString(),
    uploadsDir,
    keys,
    guids: { people, posts, comments, conversation, messages },
    times: { p1: new Date('2020-06-01T12:00:00Z') },
    drop: async () => {
      await adminClient.unsafe(`drop database if exists "${name}" with (force)`);
      await adminClient.end();
    },
  };
}
