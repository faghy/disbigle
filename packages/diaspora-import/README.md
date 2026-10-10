# @disbigle/diaspora-import

In-place migration of a diaspora\* pod to Disbigle. The tool reads the pod's database and its
`public/uploads` directory and writes the same people, handles, RSA keys and GUIDs, plus their
content, into a Disbigle database configured for **the same domain**. Remote pods keep talking
to the same identities and notice nothing.

## Usage

```sh
# Disbigle configuration comes from the environment / repository .env, as for the server:
# DATABASE_URL, PUBLIC_URL, LOCAL_DOMAIN (must be the pod's domain), MEDIA_DIR, …
pnpm --filter @disbigle/diaspora-import run import \
  --source postgres://diaspora@localhost/diaspora_production \
  --uploads /srv/diaspora/public/uploads \
  [--dry-run] [--batch-size 500] [--include-private-details]
```

(`pnpm … import` without `run` would start pnpm's own `import` command.)

It prints a table with, for every entity, how many rows were **created**, how many were already
there (**existing**), how many were **skipped**, then the files copied or missing, and the
warnings.

Suggested procedure:

1. Put the diaspora\* pod in read-only mode (or stop it) and take a backup.
2. Run with `--dry-run` and read the warnings. Nothing is written: the whole import runs in a
   transaction that is rolled back, and no file is copied.
3. Run for real. Re-running is safe at any time (see *Idempotency*), so you can import once to
   test and again at the switch-over to pick up what changed in between.
4. Keep serving the old `public/uploads/images/` directory at `/uploads/images/` from the web
   server: remote pods have copies of posts and profiles that link to those URLs.

As a library:

```ts
import { importDiasporaPod } from '@disbigle/diaspora-import';

const summary = await importDiasporaPod({
  source: 'postgres://…', // or any DiasporaReader
  target: coreContext, // { db, config, kv }
  options: { uploadsDir, mediaStorage, dryRun, batchSize, onProgress },
});
```

## Source databases

The importer reads through the `DiasporaReader` interface (`src/source/types.ts`), which returns
normalised rows. `SqlDiasporaReader` implements it with portable SQL (`?` placeholders, no
engine-specific casts, booleans and dates normalised) on top of a two-method `SqlClient`.
PostgreSQL is implemented (`createPostgresReader`); a MySQL reader only needs a `SqlClient`
around `mysql2` that runs a query and returns plain rows. The PostgreSQL connection is opened
read-only, and `timestamp without time zone` values are read as UTC, as Rails writes them.

## Mapping

Every row is read in keyset-paginated batches (`id > last id`), in this order: people, aspects,
contacts, status messages, reshares, comments, likes, conversations, then counters. New rows get
UUIDv7 ids built from the **original creation time**, so timelines keep the diaspora\* order, and
keep their original `created_at`.

### Domain check

The local users' handles must be on `LOCAL_DOMAIN`; otherwise the import stops before writing
anything. An in-place migration that changes the domain would change every handle.

### Local users (`people` with `owner_id` + `users`)

| diaspora\* | Disbigle |
| --- | --- |
| `users.username`, `people.guid` | `actors.username`, `actors.diaspora_guid` (domain null), federation URLs from `localActorUrls` |
| `users.serialized_private_key` (PKCS#1 PEM) | `users.private_key_pem` as PKCS#8 PEM |
| `people.serialized_public_key` (SPKI or PKCS#1) | `actors.public_key_pem` as SPKI PEM, derived from the private key (a mismatch is reported) |
| `users.encrypted_password` (Devise bcrypt) | `users.password_hash` = `$diaspora-bcrypt$` + the bcrypt hash |
| `users.email` | `users.email` (empty or duplicate → placeholder `<user>.<guid>@invalid.invalid`, with a warning) |
| `users.language` | `users.locale`: `it*` → `it`, anything else → `en` |
| `roles.name` | `admin` → admin, `moderator` → moderator, otherwise user (`spotlight` is ignored) |
| `users.locked_at` | `users.disabled_at` |
| `people.closed_account` | `users.disabled_at` and `actors.suspended_at` (the handle stays reserved) |
| `users.created_at`, `last_sign_in_at` | same |

Imported accounts are approved, get both protocols, and no default aspects (they bring their
own). The Ed25519 keys are left empty; the core creates them when first needed.

A username that breaks Disbigle's rules (diaspora\* also allows `.` and `-`, up to 32
characters) is kept, because the handle must not change, and reported. A local username that
already exists on Disbigle with another GUID is not imported (reported).

**Passwords.** Devise hashes `password + pepper` with bcrypt; the pepper is `config.pepper` in
diaspora's `config/initializers/devise.rb` (`DEFAULT_DIASPORA_PEPPER`, the same on every pod
unless the admin changed it). The hash is stored as `$diaspora-bcrypt$$2a$10$…`; the core
verifies it with the pepper and replaces it with Argon2id at the first successful login
(`verifyDiasporaPassword` in `src/password.ts` is the reference implementation). bcrypt only
reads the first 72 bytes, exactly as in Ruby.

### Profiles

- Display name: `first_name last_name`, else the username (diaspora's `name_from_attrs`).
- `searchable` → `discoverable`. `nsfw` profiles → all their posts and comments are `sensitive`.
- Bio, location, gender and birthday are what diaspora\* calls *profile details*: shown publicly
  only when `public_details` is true, otherwise to contacts only. Disbigle profiles are public,
  so they are imported only for public profiles (or for everyone with
  `--include-private-details`). Local bios are stored as plain text (the markdown source);
  remote bios are rendered and sanitised to HTML, as the bridge does. Location, gender and
  birthday become profile fields; a birthday without year (diaspora\* stores the year 1004) is
  written `MM-DD`.
- Avatar (`image_url`, the `thumb_large_` version): for local users the file is copied from
  `uploads/images/` to `diaspora/avatars/<file>` in media storage; if it is missing or no
  storage is given, the old absolute URL is kept. Remote avatars stay remote URLs (relative ones
  resolved against the person's pod).

### Remote people (`people` without `owner_id`)

Remote `actors` with `protocols = {diaspora}`, `preferred_protocol = diaspora`, the GUID,
username and domain from `diaspora_handle`, the public key as SPKI, `diaspora_receive_url =
<pod>/receive/users/<guid>` and `ap_url = <pod>/people/<guid>`, where `<pod>` comes from `pods`
(scheme from `ssl`, `port` when not default). An actor already known by handle (for example
through ActivityPub) is reused and gains the diaspora\* identity. Closed accounts, people with an
unreadable key and people on this pod without a user are skipped.

### Aspects, contacts and follows

Aspects keep their name and order (`order_id`). Contact semantics, from `app/models/contact.rb`
and `User#share_with`:

- `sharing = true`: *the person shares with the user* — the user receives the person's posts.
  In Disbigle terms the **user follows the person**: `follows(user → person)`.
- `receiving = true`: *the user shares with the person* (set by `share_with`, i.e. adding the
  person to an aspect) — the person receives the user's posts: `follows(person → user)`.

Both flags give both follows. Between two local users each side has its own contact row; both
are applied and duplicates collapse. Aspect memberships (`aspect_memberships` → contact →
person) become `aspect_memberships` of the person's actor, whatever the flags.

### Posts (`posts.type = 'StatusMessage'`)

- `public = true` → `public`; otherwise `limited`.
- Audience of a limited post (`post_audiences`): the local users who received it
  (`share_visibilities`) plus, for local authors, the current members of the aspects it was
  shared with (`aspect_visibilities`, also stored as `post_aspects`). diaspora\* only records
  recipients on the receiving pod, so for remote recipients the aspect membership at import time
  is the best available answer. Remote private posts get the local users who received them.
  Public posts get the mentioned people as audience, as in the core.
- Text: diaspora\* markdown kept as the source of local posts; mentions `@{Name; user@host}`
  become `@user` (local) or `@user@host` (remote); handles the Disbigle syntax cannot express
  become a markdown link to the profile, unknown people plain `@Name`. The HTML is rendered with
  the core `renderMarkdown`, resolving mentions to profile URLs and tags to `/tags/…`. Remote
  posts store only the HTML, like posts received by the bridge.
- `guid` → `diaspora_guid`. Local posts get `ap_uri = <actor>/statuses/<id>` and
  `ap_url = <PUBLIC_URL>/@user/<id>`; remote posts have none.
- Mentions: `mentions` rows (`mentions_container_type = 'Post'`). Tags: `taggings` plus the tags
  found in the text, lowercased.
- Polls are appended as text with their final results (`**question**` and one line per
  answer); individual votes are not imported.
- Photos (`photos.status_message_guid`) → `media_attachments` in order, with `text` as
  description and the stored width/height. Local photos: the original (`unprocessed_image`) is
  copied to `diaspora/images/<file>` and `scaled_full_` (or `thumb_large_`) as preview; when
  missing, the attachment points to the old URL. Remote photos keep
  `remote_photo_path + remote_photo_name`. Files are copied as they are (diaspora\* already
  strips EXIF on upload).

### Reshares, comments, likes

- Reshare → reblog (`reblog_of_id` = the post with `root_guid`), same visibility as the original,
  its own GUID; local ones get `ap_uri = <actor>/statuses/<id>/activity`. Reshares of posts that
  are gone or not public are skipped.
- Comment → reply post: `in_reply_to` and `thread_root` = the post, same visibility as the post;
  replies to private posts get the post's audience plus its author. Comments and likes on a
  reshare go to the reshared post, as in the core.
- Like with `positive = true` → `likes` (on posts and on comments), keeping the GUID; local ones
  get `ap_uri = <actor>#likes/<id>`. Dislikes are ignored.

### Conversations

Each conversation becomes one `direct` thread, in the same shape the diaspora\* bridge uses: the
root post carries the **conversation GUID**, its author and `**subject**` followed by the first
message; every other message is a reply to the root with its own GUID. The audience is every
participant (`conversation_visibilities`); replies add the root's author.

### Counters, notifications

`replies_count`, `reblogs_count` and `likes_count` are recomputed from the data at the end.
Notifications are **not** imported: users start with an empty notification list.

### Not imported

Notifications, poll votes, post locations, open graph/oEmbed caches, profile tags, tag
followings, blocks, reports, two-factor secrets, OAuth applications, invitation codes,
participations, exports. The first message GUID of a conversation is not kept (the root carries
the conversation GUID).

## Idempotency

Everything is matched on stable keys: actors by diaspora\* GUID (remote ones also by handle),
aspects by owner and name, follows and likes by their pair, memberships by their key, posts,
comments, reshares, conversations and messages by GUID. A second run creates only what is new.
Each batch of posts is written in one transaction with its audience, mentions, tags and media, so
an interrupted run resumes cleanly.

Accounts that have not signed in to Disbigle yet (their hash is still the diaspora\* one) are
refreshed on every run: password, role, locale, disabled state and profile. Removals made on the
pod between two runs (unfollows, deleted posts) are not propagated.

## Tests

`pnpm --filter @disbigle/diaspora-import test` builds a diaspora\*-shaped PostgreSQL database
from `test/fixtures/diaspora-schema.sql` (the tables the importer reads, as of the latest
diaspora\* migrations), fills it with a small pod and checks the result through the core
(`getStatus`, `homeTimeline`, `getStatusContext`).
