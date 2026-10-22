# KinetiQ

Turn a topic into a deck of swipeable fact cards — where every card is labelled with whether
it was verified against a live web source or inferred by the model.

Type `Premier League`, pick a freshness mode, and swipe through 15–20 cards. Each one carries
a short fact plus a credibility badge: 🟢 **Verified** with a source link, or 🟡 **AI-inferred**.

> **Status: early development.** The backend foundation (auth, validation, error handling,
> data model) is complete. Card generation and the client are not built yet.

## Why it isn't an AI wrapper

Claims are not trusted on the model's word. Each generation runs a live web search, and the
service then checks every cited URL against the results search *actually* returned —
downgrading any card that claims verification it can't back up. Verification is done by our
code against observed evidence, not self-reported by the model.

## Stack

**Backend** — TypeScript · Express 5 · Prisma 7 (Postgres, `pg` adapter) · Zod 4 · Redis
**AI** — Claude API with server-side web search and structured outputs
**Client** — React · Tailwind · framer-motion, as a mobile-first PWA *(not started)*

## Layout

```
client/    React PWA                          (empty)
server/    Express API                        (auth complete)
docs/      Product spec, architecture, plan
```

## Running locally

Requires Node 20+ and a Postgres database.

```bash
cd server
npm install
```

Create `server/.env`:

```
DATABASE_URL="postgresql://user:password@localhost:5432/kinetiq"
JWT_ACCESS_SECRET="<random 32+ byte string>"
JWT_REFRESH_SECRET="<a different random 32+ byte string>"
PORT=3000
NODE_ENV=development
```

Then:

```bash
npx prisma generate
npx prisma migrate dev
npm run dev
```

API at `http://localhost:3000`.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Returns an access token + refresh token |
| `POST` | `/api/auth/refresh` | Rotates the refresh token, issues a new access token |
| `POST` | `/api/auth/logout` | Revokes the session |

Access tokens last 15 minutes; refresh tokens are stored server-side, rotated on every use,
and reusing an old one revokes every session for that user.

## Docs

- [Product & project spec](./docs/kinetiq-context.md) — what it is, the end goal, scope
- [Architecture](./docs/architecture.md) — system design, data model, AI pipeline, build status
- [Backend implementation plan](./docs/backend-implementation-plan.md) — build order and code templates
