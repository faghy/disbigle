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
| 2026-10-11 | Work happens on feature branches with a pull request to `main` | The maintainer reviews before merging. |
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
