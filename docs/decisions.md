# Decisions log

Choices made during implementation that the architecture document leaves open. Newest last.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-11 | Primary keys are UUIDv7 generated in the application | Time-ordered like Mastodon's snowflake IDs, but plain strings in JS (no bigint handling) and independent of the PostgreSQL version (`uuidv7()` only exists from PG 18). |
| 2026-10-11 | Internal packages export TypeScript sources directly; apps run with `tsx` | No build step between packages while the codebase is young. A production bundle can be added later without changing package boundaries. |
| 2026-10-11 | TypeScript 7 (native compiler) for type checking, Biome for lint and format | Fast feedback on every change; one tool instead of ESLint + Prettier. |
| 2026-10-11 | The first registered user becomes admin and can register even when registrations are closed | Bootstraps a fresh instance without a separate CLI step. |
| 2026-10-11 | One RSA 4096 key pair per actor, generated at registration | Shared by the ActivityPub and diaspora identities, as in the architecture document. |
| 2026-10-11 | Sessions are opaque random tokens in an `HttpOnly` cookie; only their SHA-256 hash is stored | A database leak does not expose usable sessions; sessions can be listed and revoked. |
| 2026-10-11 | A password login with TOTP enabled creates a 10-minute `mfa_pending` session, upgraded after the second factor; max 5 attempts | Keeps the password step and the second factor in one server-side flow. |
| 2026-10-11 | Passkeys work both as passwordless sign-in and as second factor | Modern default; discoverable credentials are required at enrollment. |
| 2026-10-11 | TOTP secrets are stored unencrypted for now | To revisit: encrypt at rest with a dedicated key (Mastodon uses `OTP_SECRET`). |
| 2026-10-11 | Usernames: 1–30 letters, digits or underscores, case-insensitive unique; a small list is reserved | Same rule as Mastodon, compatible with diaspora handles. |
| 2026-10-11 | UI languages: English (default) and Italian from day one | International project with an Italian community. |
| 2026-10-11 | ~~Work happens on feature branches with a pull request to `main`~~ (replaced below) | The maintainer reviews before merging. |
| 2026-10-11 | Visibility is one SQL predicate (`visibleTo`) used by every read path | Timelines, single posts, threads, notifications and streaming cannot disagree about who sees what. |
| 2026-10-11 | Limited (aspect) posts resolve their audience at publish time; followers-only posts follow the live follower list | Same as diaspora for aspects; same as Mastodon for followers-only. |
| 2026-10-11 | Home timeline is a query, not a Redis fan-out, for now | Simpler and always correct; fan-out can be added when instances grow. |
| 2026-10-11 | Post length limit 5000 characters | Between Mastodon (500) and diaspora (65535); long enough for diaspora-style posts. |
| 2026-10-11 | Images are re-encoded on upload (EXIF and GPS stripped), previews in WebP; media of non-public posts are not yet behind signed URLs | Privacy by default for metadata; signed URLs are a follow-up. |
| 2026-10-11 | Every follow of a remote account starts as a follow request until the remote server sends Accept | Correct ActivityPub semantics; the UI shows "requested". |
| 2026-10-11 | Fedify handles ActivityPub (signatures, WebFinger, NodeInfo, delivery queue on Redis); the API server also drains the queue unless `RUN_FEDERATION_QUEUE=false` | One process is enough for small instances; workers scale delivery out. |
| 2026-10-11 | Incoming Accept/Reject match the Follow by its id instead of dereferencing it | The embedded Follow has an id on our origin; dereferencing it would fetch our own actor. |
| 2026-10-11 | Scheduled jobs use plain timers with a Redis lock instead of BullMQ | Two small jobs do not need a job framework; Fedify already provides the delivery queue. |
| 2026-10-11 | ioredis 5 everywhere | Required by `@fedify/redis`. |
| 2026-10-11 | Account deletion closes the account at once and purges data after 24 hours | The grace period lets the Delete activity (signed with the account's keys) reach other servers. |
| 2026-10-11 | Data export is a single JSON document; no media files inside | Simple and portable; media keep their public URLs. |
| 2026-10-11 | Password reset tokens live one hour in Redis; reset signs out every session | No extra table; a stolen session dies with the reset. |
| 2026-10-11 | Post edits are federated as ActivityPub Update; diaspora* keeps the original text | diaspora has no edit concept. |
| 2026-10-11 | Account moves follow Mastodon (alsoKnownAs + Move); diaspora AccountMigration is used for moves verified by signature | Interoperability with both networks. |
| 2026-10-11 | An instance actor (`/users/~actor`) signs remote fetches | Servers in authorized-fetch mode (e.g. mastodon.social) refuse unsigned requests. Remote lookups only work from a publicly reachable domain. |
| 2026-10-11 | diaspora* follows take effect immediately; ActivityPub follows wait for Accept | diaspora has no accept step. |
| 2026-10-11 | When an account speaks both protocols, ActivityPub is used for delivery | `preferred_protocol`; avoids double delivery to Friendica/Hubzilla. |
| 2026-10-11 | diaspora deliveries go through a Redis job queue (leases, retries over ~2 days, dead letters) consumed by the worker | Survives restarts; independent of Fedify's queue. |
| 2026-10-11 | Importer: a diaspora contact with `sharing` becomes the user following that person; `receiving` becomes the person following the user | That is what the flags mean in diaspora's `contact.rb`; the full rules are in `packages/diaspora-import/README.md`. |
| 2026-10-11 | Imported diaspora passwords (Devise bcrypt + pepper) are accepted and rehashed to Argon2id on first sign-in | Users keep their passwords across the migration. |
| 2026-10-11 | No Docker; production runs with systemd units and nginx (`deploy/`) | Requested; simple to operate on a single VPS. |
| 2026-10-11 | The worker caches remote images locally (re-encoded, previews), behind SSRF checks and size limits; `CACHE_REMOTE_MEDIA=false` disables it | Readers don't reveal their IP to remote servers and media survive remote outages, as on Mastodon. |
| 2026-10-11 | Mastodon-compatible client API on the same `/api/v1` paths, chosen per request: OAuth bearer tokens → Mastodon, session cookie or `x-disbigle-api: native` → native | Apps work with their usual server address; the native API keeps its shapes. Moving native to `/api/native/v1` remains an option if more clashes appear. |
| 2026-10-11 | Mastodon lists are aspects | Same idea (named groups of people) without a second concept; an aspect is also an audience, which users should know. |
| 2026-10-11 | Remote post ids derive from the publication date | Backfilled or late posts sort where they belong, as on Mastodon. |
| 2026-10-11 | Changing or resetting the password revokes OAuth app tokens | A compromised password should not leave apps signed in. |
| 2026-10-11 | Keyword filters remove posts server-side | Works the same in the web client and in apps; no client-side filtering needed. |
| 2026-10-11 | A remote identity (diaspora guid, ActivityPub id) belongs to the first account that claims it; later claims from another handle or server are refused | Prevents account takeover through a forged hcard or actor document. |
| 2026-10-11 | A remote object id reused by another author is ignored; Deletes only tombstone the sender's own posts or URIs on its own server | One server can't hijack or pre-delete another server's posts. |
| 2026-10-11 | Limited (aspect) posts are delivered over ActivityPub one recipient at a time, each addressed to that recipient only | As on diaspora, aspect members don't learn who else is in the aspect. Costs one request per recipient. |
| 2026-10-11 | Suspended accounts and accounts pending deletion can't sign in; their web sessions, OAuth tokens and open streams stop working | Moderation and deletion take effect at once. Streams re-check credentials every minute. |
| 2026-10-11 | Cookie-authenticated WebSockets must come from our own origin | Browsers send cookies on cross-site WebSocket handshakes. |
| 2026-10-11 | Hashtag search and counts only reflect public posts (not unlisted) | A tag used only in private posts shouldn't leak; matches Mastodon's tag pages. |
| 2026-10-11 | Push endpoints must resolve to public addresses before each send | The endpoint is chosen by the client; this blocks requests to internal services. A DNS change between check and send is still possible. |
| 2026-10-11 | Accounts that opt out of discovery are found only by their exact username | Same rule for local and remote accounts; diaspora's "searchable" behaves similarly. |
| 2026-10-11 | Second-factor attempts are limited per sign-in (5) and per user (15 per hour) | A known password must not buy unlimited guesses. |
| 2026-10-11 | Comments cross between diaspora* and ActivityPub through bridge identities (`user_at_domain@<our domain>`, own key, clearly labelled), on public threads started here | Each protocol needs comments signed by an identity it can verify; a bridge account is honest about what it is and lets both networks see the whole conversation. Likes, unlikes and deletions follow the same path; private threads are not bridged yet. |
| 2026-10-11 | Replies received over ActivityPub on a public local thread are forwarded, as signed, to the thread author's followers | Inbox forwarding, as Mastodon does, so ActivityPub followers see replies from other ActivityPub servers. |
| 2026-10-11 | Retractions of bridged comments and likes are relayed by the thread's author, naming the bridge identity as author | diaspora* accepts retractions of comments and likes from their author or from the thread root's author (`Retraction#sender_valid?`), the same path relayed comments take. |
| 2026-10-11 | Commits go straight to `main`, no pull requests | Asked by the maintainer once the first version was merged; CI still runs on every push. |
| 2026-10-11 | A new remote follower receives the account's last 5 public top-level posts (once a week at most per follower) | Otherwise a profile looks empty on the follower's server until the next post, and there is nothing to like or comment on. Other servers don't do it; followers-only posts are left out. |
