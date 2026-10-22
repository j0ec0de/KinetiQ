# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `server/` (the only buildable package; `client/` is empty).

```bash
npm install
npx prisma generate      # REQUIRED before first run and after every schema change
npx prisma migrate dev   # apply schema to Postgres
npm run dev              # ts-node-dev, respawns on change, port 3000
```

`npx prisma generate` is not optional: the generated client is gitignored, and `src/prisma.ts`
imports from `./generated/prisma/client`, so nothing compiles on a fresh clone without it.

**There is no test, lint, or build command.** `npm test` is still the npm-default error stub,
and no linter is configured. `tsconfig.json` defines `outDir: dist` but no script invokes
`tsc`. Don't invent commands for these — if a task needs one, add it deliberately.

## Architecture

TypeScript/Express 5 modular monolith over Postgres (Prisma 7) with a planned Redis cache.
Product: a topic becomes a deck of swipeable fact cards, each labelled verified-against-a-source
or model-inferred.

### Module convention

Every domain under `src/modules/<domain>/` is four files: `.routes.ts`, `.schema.ts`,
`.controller.ts`, `.service.ts`. The boundary is strict and load-bearing:

- **Controllers** handle HTTP only — destructure `req`, call a service, shape the response.
  No Prisma, no business logic. Always wrapped in `asyncHandler`.
- **Services** hold business logic and own all Prisma access. They never touch `req`/`res`,
  and they signal failure by throwing `HttpException` subclasses.

That split is what lets a service be called later from a job runner or another module. Keep it.

### Error flow

Understanding this requires `utils/errors.ts`, `utils/asyncHandler.ts`, and
`middleware/errorHandler.ts` together:

```
service throws BadRequestException  →  asyncHandler forwards to next()  →  errorHandler formats
```

`errorHandler` is terminal and the single place a response shape is constructed. Anything that
isn't an `HttpException` becomes a 500 with the message suppressed in production. Never build an
error response in a controller.

### Validation

`validateRequest` packs `body`, `query`, and `params` into one object before parsing, so every
schema must be shaped accordingly:

```ts
export const registerSchema = z.object({ body: z.object({ ... }) });
```

The middleware then strips the `body`/`query`/`params` prefix from error paths so clients see
`"email"`, not `"body.email"`.

### Auth model

Access tokens are stateless and short-lived (15m). Refresh tokens are persisted as `Session`
rows, rotated on every use, and reuse of a consumed token deletes *all* of that user's sessions
as theft detection. `requireAuth` deliberately does no database lookup — verifying the signature
is the whole job.

`requireAuth` exists but is not yet applied to any route, so it has never actually executed.

### Planned AI pipeline (not built)

The core feature. Design is settled; see `docs/architecture.md` §5 before implementing.

One Claude Messages request per generation, declaring the server-side `web_search` tool with the
card array as structured output — there is no separate search vendor. Then the service
cross-checks every card's `sourceUrl` against the URLs search actually returned and downgrades
unmatched `VERIFIED_SOURCE` cards to `AI_INFERRED`.

**That verification step is the product.** A model that invents a fact can invent a plausible
URL for it, so grounding must be checked by our code against observed evidence, never
self-reported by the model. A 🟢 badge without a working source link is the one bug that
invalidates the whole premise.

Cards are stored as `Json` in `Generation.response` — a discriminated union of five types,
always read as a whole deck, never queried by field. The Zod card schema is the contract shared
by the LLM response format, the write path, and the client.

## Repo-specific gotchas

| Thing | Detail |
| --- | --- |
| **Zod 4, not 3** | `z.email()` not `z.string().email()`; `error.issues` not `error.errors`; `AnyZodObject` no longer exists (use `ZodSchema<T>`). |
| **Express 5 `req.query`** | A getter — assigning to it throws. Delete keys then `Object.assign`, as `validate.ts` does. |
| **Two `prisma.config.ts` files** | `server/prisma.config.ts` is the one the Prisma CLI reads. `server/src/prisma.config.ts` is a divergent duplicate that nothing imports — dead code, safe to delete. |
| **Prisma client import** | Always `src/prisma.ts` (builds a `pg` `Pool`, wraps in `PrismaPg`). Neither `prisma.config.ts` exports a client; importing one expecting a client fails silently at runtime. |
| **JWT secrets missing** | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are read by code but absent from `.env`, so `auth.service.ts` falls back to the literals `"access_secret"` / `"refresh_secret"`. Every token issued now is forgeable. Fix before any deploy, and make it throw on boot rather than fall back. |
| **`datasource` has no `url`** | Intentional — Prisma 7 driver-adapter setup supplies it via `prisma.config.ts` and the `pg` Pool. |

## Docs are authoritative for design

This repo is documentation-led; design decisions live in `docs/`, not in code comments.

- `docs/kinetiq-context.md` — product spec: end goal, scope (v1/v2/out), non-negotiables
- `docs/architecture.md` — system design, data model, AI pipeline, build status, build order
- `docs/backend-implementation-plan.md` — build order with code templates

Where the implementation plan and `architecture.md` disagree, **`architecture.md` wins**.

Known decisions worth not relitigating: portfolio-first over growth; Claude's built-in web
search over a separate search vendor; mobile-first PWA over native; AI image generation
permanently out of scope; social/feed features deferred to v2. Each has a stated reason in the
docs — read it before proposing a reversal.

Four additive schema gaps block v1 (period window on `Usage`, nullable `userId` for anonymous
generations, a share slug, unique `Session.refreshToken`); they are listed in
`docs/architecture.md` §4.
