# KinetiQ — System Architecture

> *How* KinetiQ is built. For *what* and *why*, see [kinetiq-context.md](./kinetiq-context.md).
> For backend build order and code templates, see
> [backend-implementation-plan.md](./backend-implementation-plan.md).

---

## 1. Repository Layout

A two-package monorepo. No workspace tooling — the two halves deploy independently and share
only a hand-maintained types file.

```
kinetiq/
├── client/                      # React PWA              (not started)
├── server/                      # Express API            (auth complete)
│   ├── prisma/
│   │   └── schema.prisma        # Postgres data model
│   ├── prisma.config.ts         # Prisma 7 CLI config — the one the CLI actually reads
│   └── src/
│       ├── index.ts             # App entry: middleware chain, route mounting
│       ├── prisma.ts            # PrismaClient singleton (pg adapter + Pool) — import from here
│       ├── prisma.config.ts     # ⚠️ divergent duplicate of the above config; nothing imports it
│       ├── generated/prisma/    # Generated client — gitignored; run `prisma generate` after clone
│       ├── middleware/          # auth · validate · errorHandler
│       ├── utils/               # errors · asyncHandler
│       └── modules/             # One directory per domain
│           ├── auth/            # ✅ complete
│           ├── user/            # ⬜ not started
│           ├── prompt/          # ⬜ not started
│           └── generation/      # ⬜ not started
└── docs/
```

### Module convention

Every domain module is four files. No shared "services" or "helpers" dumping ground — if two
modules need the same logic, it moves to `utils/` or one module calls the other's exported
service class.

```
modules/<domain>/
├── <domain>.routes.ts       # Router: path → validator → guard → controller
├── <domain>.schema.ts       # Zod schemas (request shape only)
├── <domain>.controller.ts   # HTTP in/out. No business logic. Wrapped in asyncHandler.
└── <domain>.service.ts      # Business logic + Prisma. Throws HttpException subclasses.
```

The controller never touches Prisma; the service never touches `req`/`res`. That boundary is
what keeps services testable and reusable from a future job runner.

---

## 2. Stack & Rationale

| Layer | Choice | Why this and not the alternative |
| --- | --- | --- |
| API | Express 5 + TypeScript | Express 5 has native async error propagation, which is what makes `asyncHandler` + a single global error handler work cleanly |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Driver adapters are the Prisma 7 direction; owning the `pg` `Pool` means connection-limit control on free-tier Postgres |
| Validation | Zod 4 | Request validation and LLM output schema from one library — the card schema is reused for both |
| DB | PostgreSQL | Relational user/prompt/generation graph, plus `Json` columns for card payloads. Both shapes, one database. |
| Cache | Redis | Generation dedup. This is where most of the AI cost savings come from. |
| AI | Claude API (`@anthropic-ai/sdk`) | Server-side web search is built into the Messages API, so grounding needs no second vendor — see §5 |
| Auth | JWT access + DB refresh tokens | Rotation and reuse-detection are only possible with server-side session records |
| Client | React + Tailwind + framer-motion, as a PWA | Mobile-first swipe UX from one codebase, shareable as a URL — see §8 |

---

## 3. Request Lifecycle

The middleware chain, in execution order. Order matters: Helmet before anything renders,
rate limiting before expensive work, validation before the guard so malformed requests fail
fast and cheap.

```
Request
   │
   ▼
helmet()                      Security headers
   │
   ▼
cors()                        Origin allowlist
   │
   ▼
morgan() → winston            Structured request logging
   │
   ▼
express.json()                Body parsing
   │
   ▼
rateLimit()                   Per-IP throttle (stricter on /generations)
   │
   ▼
validateRequest(schema)       Zod → 400 BadRequestException with field-level errors
   │
   ▼
requireAuth                   JWT verify → req.user  (omitted on public routes)
   │
   ▼
Controller                    asyncHandler-wrapped; destructure, call service, send
   │
   ▼
Service                       Cache → limits → AI → transaction
   │
   ▼
errorHandler                  Terminal. HttpException → status; anything else → 500.
```

### Error contract

Every failure leaves through `errorHandler` with one response shape. Services throw typed
exceptions (`BadRequestException`, `ConflictException`, …); nothing else constructs an error
response.

```json
{
  "status": "error",
  "statusCode": 409,
  "message": "A user with this email or username already exists",
  "errors": [{ "field": "email", "message": "Invalid email address format" }]
}
```

`errors` appears only for validation failures. Stack traces appear only outside production.

---

## 4. Data Model

Current schema (`server/prisma/schema.prisma`):

```
User ──┬── Prompt ──── Generation          Generation.response holds the card array
       │     │                              as Json — the card schema is enforced in
       │     └── PromptTag ──── Tag         TypeScript, not in Postgres
       ├── Generation
       ├── Session                           Refresh tokens, one row per active login
       └── Usage (1:1)                       Prompt + token counters
```

**Why cards are `Json` and not tables.** Cards are a discriminated union of five shapes,
always read as a whole deck, and never queried by field. Normalizing them would mean five
tables and a polymorphic join to retrieve something that is only ever fetched as one blob.
The schema is enforced at the boundary by Zod on write.

### The card contract

This type is the core contract between the LLM, the database, and the client. It lives in
`generation.schema.ts` as a Zod schema; the TypeScript type is inferred from it.

```ts
type CardType    = "FACT" | "STAT" | "COMPARISON" | "TIMELINE" | "QUIZ";
type Credibility = "VERIFIED_SOURCE" | "AI_INFERRED";

interface Card {
  id:          string;
  type:        CardType;
  title:       string;
  body:        string;
  credibility: Credibility;

  // Required when credibility is VERIFIED_SOURCE, absent otherwise.
  sourceUrl?:   string;
  sourceTitle?: string;

  // Type-specific payload. Exactly one is populated, matching `type`.
  data?:
    | { kind: "STAT";       value: string; label: string }
    | { kind: "COMPARISON"; left: { label: string; value: string }; right: { label: string; value: string } }
    | { kind: "TIMELINE";   events: Array<{ when: string; what: string }> }
    | { kind: "QUIZ";       options: string[]; answerIndex: number };
}
```

**One invariant, enforced on write:** `credibility === "VERIFIED_SOURCE"` requires a
non-empty `sourceUrl`. A verified badge with no link is the one bug that invalidates the
product premise (see kinetiq-context.md §8), so it is a schema-level refinement, not a
convention.

### Schema gaps blocking v1

Found by reading the current schema and auth service against the v1 scope. All are additive.

| Gap | Impact | Fix |
| --- | --- | --- |
| `Session.refreshToken` is not `@unique` | Lookups use `findFirst` on an unindexed column; will degrade as sessions accumulate | Add `@unique`, switch to `findUnique` |
| `Usage` has no period window | A "10 decks/day" limit cannot reset — `totalPrompts` is a lifetime counter | Add `periodStart DateTime` + `periodPrompts Int` |
| `Prompt.userId` / `Generation.userId` are non-nullable | Blocks anonymous demo generations, which the v1 flow depends on | Make nullable, or add an `anonymousId` column |
| No share slug | Public share links have no stable public identifier; exposing a UUID leaks the primary key | Add `shareSlug String? @unique` to `Prompt` |
| `Prompt.visibility` is unused | Already modelled — just needs wiring to the share endpoint | No schema change |

---

## 5. The AI Layer

This is the part that makes KinetiQ not a wrapper, so it gets the most detail.

### Key architectural decision: no separate search vendor

Earlier drafts of the plan assumed Tavily or Serper as a search layer feeding snippets into
the model. **That is no longer necessary.** The Claude Messages API has a server-side web
search tool: it is declared in the request's `tools` array, executes on Anthropic's
infrastructure, and returns results as content blocks in the same response.

What this collapses:

| With a search vendor | With built-in web search |
| --- | --- |
| Two API keys, two SDKs, two rate limits | One |
| Search call → assemble context → generation call | One request |
| Hand-written snippet-to-context formatting | Handled server-side |
| Citation URLs stitched together manually | Returned with the results |

### Generation pipeline

```
         ┌──────────────────────────────────────┐
         │ POST /api/generations                │
         │ { topic, freshness }                 │
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ Normalize + hash                     │   lowercase, trim, collapse whitespace
         │ sha256(topic) + freshness            │   → stable cache key
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ Redis GET                            │──── HIT ──→ return (< 200ms)
         └──────────────────┬───────────────────┘
                            │ MISS
                            ▼
         ┌──────────────────────────────────────┐
         │ Check limits (user or IP)            │──── OVER ──→ 400
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ ONE Claude request:                  │
         │  · system prompt + card schema       │   ← cached prefix
         │  · web_search tool declared          │
         │  · output_config.format = card array │
         │  · topic + freshness                 │   ← volatile, last
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ Post-process                         │
         │  · Zod-validate the card array       │
         │  · cross-check each sourceUrl against│
         │    the URLs search actually returned │
         │  · downgrade unmatched 🟢 → 🟡       │
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ Transaction: Prompt + Generation     │
         │              + Usage increment       │
         └──────────────────┬───────────────────┘
                            ▼
         ┌──────────────────────────────────────┐
         │ Redis SET with freshness TTL         │
         └──────────────────────────────────────┘
```

**The post-process step is the credibility layer.** The model is asked to cite, but trusting
it to self-report grounding would be exactly the hallucination problem the product claims to
solve. So the service extracts the URLs that the `web_search_tool_result` blocks actually
returned, and any card claiming `VERIFIED_SOURCE` with a `sourceUrl` not in that set gets
downgraded to `AI_INFERRED`. Verification is done by our code against observed evidence, not
asserted by the model.

### API shape

Specifics that the implementation needs to get right:

| Concern | Setting |
| --- | --- |
| Model | `claude-opus-5-5` |
| SDK | `@anthropic-ai/sdk` |
| Web search tool | `{ type: "web_search_20260209", name: "web_search" }`, with `max_uses` set to bound cost |
| Structured output | `output_config: { format: … }` — **not** the deprecated `output_format` |
| Thinking | `{ type: "adaptive" }` or omit entirely. `disabled` and `budget_tokens` both return 400 on this model. |
| Effort | `output_config: { effort: "medium" }` — set explicitly; Opus 5.5 defaults to `medium`, not `high` |
| Tool choice | Leave as `auto`. Forced `tool_choice` (`any`/`tool`) returns 400 on this model. |
| `max_tokens` | ~16000 non-streaming. Don't lowball — a truncated deck means a wasted paid call. |
| Refusals | Check `stop_reason === "refusal"` **before** reading `content`. Enable server-side fallbacks (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). |

Three implementation traps worth writing down now:

1. **Don't also declare `code_execution`.** The `web_search_20260209` tool runs code
   execution internally for result filtering. Declaring a second execution environment
   confuses the model.
2. **Search errors don't throw.** A failed search returns HTTP 200 with a
   `web_search_tool_result` block whose `content` is an *object* (e.g.
   `{ error_code: "max_uses_exceeded" }`) rather than the usual *array* of results. Branch on
   that shape before indexing, or the grounding step throws on a perfectly valid response.
3. **Verify structured output composes with web search** in a throwaway spike before
   building on it. Document-block citations are known to be incompatible with
   `output_config.format`, and whether the server-side search tool shares that restriction
   needs confirming. Fallback if it doesn't compose: two calls — one search-and-summarize,
   one schema-constrained formatting pass over the result. Costs an extra call; changes no
   other part of the design.

### Prompt caching

The system prompt plus the card schema is a large, byte-stable prefix sent on every
generation — exactly what prompt caching is for. Cache reads are a fraction of input price,
so this is the single highest-leverage cost optimization after the Redis layer.

Render order is `tools` → `system` → `messages`, and any byte change invalidates everything
after it. So: tool definitions and system prompt stay frozen and come first, the user's topic
and freshness go last. **No timestamps, no request IDs, no unsorted JSON anywhere in the
prefix** — those are silent cache killers. Confirm it is working by asserting
`usage.cache_read_input_tokens > 0` across repeated requests; if it is zero, something in the
prefix is varying.

### Cost model

Roughly 5K input / 2K output tokens per generation:

| Model | $/1M in → out | Per deck | Notes |
| --- | --- | --- | --- |
| `claude-opus-5-5` | $4 → $20 | ~$0.06 | Default. Cache reads $0.20/1M. |
| `claude-sonnet-5-5` | $2 → $10 | ~$0.03 | Viable; supports web search. |
| `claude-haiku-5-5` | $0.10 → $0.50 | ~$0.0015 | **Does not support the web search tool** — would require an external search vendor, undoing §5. |

Before caching or Redis, $5 of credit is ~85 decks on Opus 5.5 or ~165 on Sonnet 5.5. With
cache hits on repeated topics, effective cost per *request* trends toward zero.

> **Prerequisite:** this needs prepaid API credits from `console.anthropic.com`. A Claude Pro
> subscription covers claude.ai and Claude Code — it does not issue an API key and cannot
> serve application traffic.

---

## 6. Caching Strategy

```
kinetiq:deck:<sha256(normalized_topic)>:<freshness>
```

| Mode | TTL | Reasoning |
| --- | --- | --- |
| `LATEST` | 4h | News moves within a day |
| `MIXED` | 12h | Default blend |
| `HISTORICAL` | 30d | Established facts don't change |

Normalization before hashing (lowercase, trim, collapse internal whitespace) is what makes
`"Premier League"`, `"premier league"`, and `"  Premier   League "` share one cache entry.
Without it the hit rate quietly collapses.

The cache is keyed on content, not user — two users asking the same thing share one entry.
That is what makes a free tier affordable, and it is a deliberate privacy tradeoff: topics
are not sensitive, so cross-user sharing is acceptable here. Saved decks remain per-user in
Postgres.

---

## 7. Rate Limiting & Abuse

Generation is the only endpoint that costs real money, so it gets its own limits.

| Scope | Limit | Enforced by |
| --- | --- | --- |
| Anonymous generation | 2 total per IP | `express-rate-limit` + IP |
| Authenticated generation | 10/day | `Usage.periodPrompts` |
| Auth endpoints | 5 attempts / 15min per IP | `express-rate-limit` |
| Global | 100 req/min per IP | `express-rate-limit` |

A cache hit should **not** consume generation quota — it costs nothing to serve. Check the
cache before decrementing the limit, which is why the pipeline in §5 orders it that way.

---

## 8. Client Architecture

Mobile-first React PWA. Not started.

```
client/src/
├── pages/            Landing · Generate · Deck · Saved · Share
├── components/
│   ├── cards/        One component per card type + CredibilityBadge
│   └── swipe/        SwipeDeck (framer-motion drag + keyboard)
├── hooks/            useGeneration · useAuth · useSwipe
├── lib/              api client (fetch + token refresh interceptor) · types
└── types/            Card types — hand-mirrored from the server contract
```

### Why a PWA

A PWA is a normal React app plus a `manifest.json` and a service worker. That buys:

- **Installable** — home screen icon, fullscreen launch, no browser chrome
- **Offline shell** — the app and saved decks open without a connection
- **One shareable URL** — a reviewer clicks a link and is swiping in seconds, with no store
  install and no TestFlight invite

`vite-plugin-pwa` generates the manifest and service worker from a short config block, so
this is additive to a normal React build rather than a separate target.

Known limitation: web push on iOS requires the user to install to the home screen first,
which is part of why daily drops are deferred to v2.

### Token handling

Access tokens live in memory only. The refresh token goes in an httpOnly cookie, and the API
client retries once through `/api/auth/refresh` on a 401. Access tokens must never touch
`localStorage` — that is XSS-readable, and the whole point of the 15-minute expiry plus
rotation is undermined if the token is sitting in readable storage.

---

## 9. Deployment

Free-tier target. The constraint that matters is **no cold-start stalls during a demo**.

| Component | Host | Notes |
| --- | --- | --- |
| Client | Vercel | Free, instant, global CDN |
| API | Railway / Render | Pick a tier that does not sleep — a 30s cold start loses the reviewer |
| Postgres | Neon / Supabase | Free tier; Neon's pooled connection string suits the `pg` Pool |
| Redis | Upstash | Serverless, generous free tier, pay-per-request |

### Environment variables

| Variable | Status | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ set | Postgres connection |
| `PORT` | ✅ set | API port |
| `JWT_ACCESS_SECRET` | ⚠️ **read by code, missing from `.env`** | Access token signing |
| `JWT_REFRESH_SECRET` | ⚠️ **read by code, missing from `.env`** | Refresh token signing |
| `ANTHROPIC_API_KEY` | ⬜ needed | Claude API |
| `REDIS_URL` | ⬜ needed | Upstash connection |
| `NODE_ENV` | ⬜ needed | Gates query logging and stack traces |
| `CORS_ORIGIN` | ⬜ needed | Client origin allowlist |

> The two ⚠️ rows are the highest-priority fix in the repo. `auth.service.ts` falls back to
> the literals `"access_secret"` / `"refresh_secret"` when they are unset, so every token
> issued right now is signed with a publicly-known key. The service should **throw on boot**
> if either is missing rather than silently falling back.

---

## 10. Build Status

| Area | Status | Detail |
| --- | --- | --- |
| Error framework | ✅ | `HttpException` + 6 subclasses, `asyncHandler`, global `errorHandler` |
| Validation | ✅ | Generic `validateRequest<T>`, Zod 4, field-level error formatting |
| Prisma setup | ✅ | Prisma 7, `pg` adapter, client singleton, `prisma.config.ts` |
| Data model | 🟡 | All 7 models defined; 4 additive gaps listed in §4 |
| Auth module | ✅ | Register, login, refresh with rotation + reuse detection, logout |
| `requireAuth` guard | 🟡 | Written, but not applied to any route yet |
| Secrets | ⚠️ | JWT secrets missing from `.env`; running on hardcoded fallbacks |
| Security middleware | ⬜ | `helmet`, `cors`, `morgan` installed but not mounted in `index.ts` |
| Logging | ⬜ | `winston` installed, not configured |
| Rate limiting | ⬜ | `express-rate-limit` installed, not mounted |
| User module | ⬜ | — |
| Prompt module | ⬜ | — |
| Generation module | ⬜ | The core feature. Nothing written. |
| AI integration | ⬜ | SDK not installed, no API credits yet |
| Redis cache | ⬜ | No client installed |
| Client | ⬜ | `client/` is empty |

**Read of the current state:** the foundations are genuinely solid — the error/validation/auth
layer is the part most portfolio projects skip, and it is done properly here, including
refresh-token rotation with reuse detection. What is missing is the entire product: nothing
yet generates a card.

---

## 11. Build Order

Sequenced so that each step is demonstrable and nothing is blocked waiting on a decision.

**Phase 0 — close the gaps (small, do first)**
1. Add JWT secrets to `.env`; make the service throw on boot if absent
2. Mount `helmet`, `cors`, `morgan`, and `express-rate-limit` in `index.ts`
3. Configure `winston`; replace `console.error` in `errorHandler`
4. Apply the four additive schema changes from §4; migrate

**Phase 1 — prove the AI path (highest risk, so do it early)**
5. Add API credits; install `@anthropic-ai/sdk`
6. Throwaway spike: one script, hardcoded topic, web search + structured output in a single
   request. This answers the §5 trap #3 question before any module depends on the answer.
7. Build `generation.schema.ts` — the Zod card schema, reused for both LLM output and
   response validation

**Phase 2 — the generation module**
8. `generation.service.ts`: the §5 pipeline, minus caching
9. `POST /api/generations` behind `requireAuth`; verify end to end
10. Add the credibility cross-check and the verified-needs-a-source refinement
11. Add Redis; add the cache-before-limits ordering
12. Add usage accounting against the new period window

**Phase 3 — surrounding API**
13. User module: `GET /api/users/me` — also the first real test of `requireAuth`
14. Prompt module: list and delete a user's decks
15. Anonymous generation path + IP limits
16. Share links: slug generation, public read-only `GET /api/share/:slug`

**Phase 4 — client**
17. Vite + React + Tailwind; PWA plugin; API client with refresh interceptor
18. Card components per type + `CredibilityBadge`
19. `SwipeDeck` with framer-motion drag and keyboard support
20. Generate flow with skeleton loaders
21. Auth screens, saved decks, share view
22. Deploy; test a cold visit on a real phone

**Phase 5 — portfolio polish**
23. README: what it is, architecture diagram, live link, screenshots, local setup
24. Seed a few compelling example topics so a cold visit is never empty
