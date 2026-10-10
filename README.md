# Disbigle

A federated social network that speaks ActivityPub and stays compatible with the diaspora* network.

- **ActivityPub first**: follow and be followed from Mastodon, Misskey, Pixelfed and the rest of the Fediverse.
- **diaspora\* compatible**: talk to existing diaspora pods, and migrate a pod in place without losing identities.
- **Aspects**: share with the people you choose (family, friends, work…), not only "public" or "followers".

Status: early development. See [docs/architettura.md](docs/architettura.md) (Italian) for the design and [docs/decisions.md](docs/decisions.md) for implementation decisions.

## The name

*Disbigle* (Italian: *disbiglio*) is a made-up word. It was born when an angry father started to call his son *disgraziato*, changed his mind halfway through, and ended up with a brand new insult. Among friends it stuck as a fond way to tell someone they messed up.

## Development

Requirements: Node.js 22.18+, pnpm, PostgreSQL 16+ and Redis 7+.

```sh
pnpm install
cp .env.example .env          # adjust DATABASE_URL, REDIS_URL, SESSION_SECRET
pnpm db:migrate               # creates the database if needed and applies migrations
pnpm dev                      # API on :3000, web client on :5173, worker
```

Open http://localhost:5173. The first account registered becomes the administrator.

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit and integration tests (needs PostgreSQL; set `TEST_DATABASE_URL` to a server where test databases can be created) |
| `pnpm typecheck` | Type checks every package |
| `pnpm lint` / `pnpm format` | Biome lint and format |
| `pnpm db:generate` | Generates a migration after editing `packages/db/src/schema.ts` |

## Layout

| Path | Contents |
| --- | --- |
| `apps/server` | HTTP API, WebSocket streaming, federation endpoints |
| `apps/worker` | Federation delivery queue and maintenance jobs |
| `apps/web` | React web client |
| `packages/core` | Domain logic: accounts, posts, aspects, visibility, timelines |
| `packages/db` | Database schema and migrations |
| `packages/activitypub` | ActivityPub adapter (Fedify) |
| `packages/diaspora` | diaspora\* protocol implementation |
| `packages/shared` | API types and schemas shared with the client |
| `packages/config` | Typed configuration |

## License

[GNU Affero General Public License v3.0](LICENSE)
