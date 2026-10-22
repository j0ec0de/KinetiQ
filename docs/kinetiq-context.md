# KinetiQ — Product & Project Spec

> The single source of truth for *what* KinetiQ is and *why*. For *how* it is built, see
> [architecture.md](./architecture.md). For backend build order, see
> [backend-implementation-plan.md](./backend-implementation-plan.md).

---

## 1. What KinetiQ Is

KinetiQ turns a topic into a deck of swipeable fact cards, where **every card tells you how
much to trust it**.

A user types `Premier League`, picks a freshness mode, and within a few seconds swipes
through 15–20 cards. Each card carries a short fact plus a credibility badge: either
🟢 **Verified** with a live source link, or 🟡 **AI-inferred** with no grounding. That badge
is the product.

### The one-line pitch

> Topic in, trustworthy swipeable facts out — with every claim labelled by whether it was
> verified against a live source or inferred by the model.

---

## 2. End Goal

**KinetiQ is a portfolio-first, production-grade project.** The primary objective is to be a
standout engineering artifact in a job search; real users are a welcome bonus, not the
success metric.

This single decision drives every tradeoff in this repo:

| Because the goal is portfolio-first… | …we optimize for | …and we deprioritize |
| --- | --- | --- |
| A reviewer gives it ~90 seconds | Instant, frictionless first impression | Onboarding funnels, email verification flows |
| It must *run* when someone clicks | Free-tier hosting that never sleeps mid-demo | Horizontal scale, multi-region |
| It must *read* as senior work | Grounding pipeline, caching, usage accounting, secure auth | Feature breadth |
| It must survive technical questioning | Deliberate, defensible decisions documented here | Clever code nobody can explain |

### Definition of done for v1

- [ ] A public URL that works on a cold visit from a phone, with **no signup required** to see a deck
- [ ] Cached topics return in **< 200ms**; cold generation completes in **< 8s** with visible progress
- [ ] Every card shows a credibility badge, and 🟢 cards link to a real, clickable source
- [ ] Auth, rate limiting, and usage accounting all actually work (not stubs)
- [ ] A README a stranger can follow to run it locally in under 5 minutes

### The resume line this earns

> Built an AI knowledge-discovery platform that grounds LLM output against live web search,
> labelling every generated fact as source-verified or model-inferred. TypeScript/Express
> modular monolith with Postgres, Redis-backed generation caching, JWT auth with rotating
> refresh tokens, and per-user usage accounting.

Every clause in that sentence must be true and defensible. That is the real acceptance test.

---

## 3. Why This Isn't an AI Wrapper

An AI wrapper takes a prompt, forwards it to a model, and renders the reply. The gap between
that and KinetiQ is where all the engineering lives:

| A wrapper does | KinetiQ does |
| --- | --- |
| Forwards the prompt verbatim | Expands the topic into sub-queries and searches the live web first |
| Renders whatever text comes back | Constrains output to a typed card schema, validated before it is stored |
| Presents all claims as equally true | Separates source-grounded facts from model-inferred ones, and cites the former |
| Pays for every identical request | Deduplicates via content-hash caching with freshness-aware TTLs |
| Has no concept of a user | Tracks per-user usage, enforces limits, and persists deck history |

**The credibility layer is the differentiator.** It is the thing to demo first and the thing
to talk about in an interview. Everything else is table stakes executed well.

---

## 4. User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. LAND                                                            │
│     Public page. No auth wall. One example deck visible immediately. │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. ASK                                                             │
│     Type a topic → pick freshness: [ Latest | Historical | Mixed ]  │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. GENERATE                                                        │
│     Skeleton cards animate in. Cache hit → instant.                 │
│     Cache miss → live search + grounded generation (~5s).           │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. SWIPE                                                           │
│     15–20 cards. Swipe/arrow through. Badge + source on each.       │
│     Tap a 🟢 badge → opens the cited source.                        │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. KEEP or SHARE                                                   │
│     Save (prompts signup if anonymous) · Share link · Regenerate    │
└─────────────────────────────────────────────────────────────────────┘
```

### The anonymous-first decision

**A reviewer will not create an account.** So the demo path must not require one.

- Anonymous visitors get **2 generations**, rate-limited by IP
- Results are fully usable — swipe, read, follow sources, share
- Signup is prompted only at the moment it buys something: **saving** a deck
- Share links are public and need no auth at all

This is both the right product call and the thing that makes the portfolio goal achievable.
It is not a shortcut; it is the design.

---

## 5. Card Types

Cards are not uniform text blocks — varied types are what make the swipe feel worth doing.

| Type | Purpose | Example |
| --- | --- | --- |
| `FACT` | The default. One self-contained claim. | "Leicester City won the 2015–16 Premier League at 5000–1 odds." |
| `STAT` | A single number, rendered large. | **91** — goals Messi scored in the 2012 calendar year |
| `COMPARISON` | Two entities, side by side. | Messi vs Ronaldo — goals in finals |
| `TIMELINE` | 3–5 ordered events. | Ballon d'Or wins, 2008 → 2023 |
| `QUIZ` | A question with a reveal. | "Who scored the fastest UCL goal?" |

**AI image generation is explicitly out of scope.** It costs roughly an order of magnitude
more per card than the text it decorates, needs its own storage and cache-invalidation path,
and does nothing for the credibility positioning. Where a card wants a visual, pull the
Open Graph image from the cited source URL instead — zero generation cost, and it reinforces
the citation rather than distracting from it.

---

## 6. Freshness Modes

The freshness toggle is what forces live data into the architecture, and it drives cache TTLs.

| Mode | Behaviour | Cache TTL |
| --- | --- | --- |
| **Latest** | Heavy live search. Recent events, current standings, transfers. | 4 hours |
| **Historical** | Little or no search. Records, legendary moments, established facts. | 30 days |
| **Mixed** | Balanced. The default. | 12 hours |

`Historical` is also the cheap path — it needs the least search and caches the longest.

---

## 7. Scope

### v1 — ship this first

**Auth & accounts**
- Email/password registration and login
- JWT access tokens with database-backed rotating refresh tokens
- Anonymous demo generations, IP rate-limited

**Generation**
- Topic input with freshness toggle
- Live-search-grounded deck generation, 15–20 cards
- All five card types
- Per-card credibility badge and source link
- Redis caching keyed on topic hash plus freshness
- Per-user usage accounting and limits

**Client**
- Mobile-first PWA: installable, offline-capable shell
- Swipe gestures on touch, arrow keys on desktop
- Skeleton loaders covering generation latency
- Saved decks library
- Public read-only share links

### v2 — deliberately deferred

These are **choices, not oversights**. Each is deferred for a stated reason.

| Feature | Why deferred |
| --- | --- |
| Public feed & deck discovery | Needs moderation thinking; share links already cover demo-ability |
| Follow topics + daily drops | Requires a scheduler and notification infra; unreliable push on iOS PWAs |
| Likes / social graph | Meaningless before there are users |
| Export as carousel / PDF | Pure polish; no engineering story |
| Tag browsing | Schema already supports it, so it stays cheap to add later |
| OAuth providers | Email/password already demonstrates the harder security work |

### Out of scope, permanently

- **AI image generation** — see §5
- **Paid tiers** — the monetization *design* is worth describing in this doc; billing
  integration is not worth building for a portfolio project

---

## 8. Non-Negotiables

Constraints that outrank feature work. If a feature breaks one of these, the feature loses.

1. **The demo must work on a cold phone visit.** No auth wall, no cold-start timeout, no
   broken layout at 375px.
2. **Never present an ungrounded claim as verified.** A 🟢 badge without a working source
   link is the one bug that invalidates the entire premise.
3. **Generation must be cost-bounded.** Cache first, hard per-user and per-IP limits, no
   path where a visitor can run up the bill.
4. **Secrets never live in the repo.** (Open item: `JWT_ACCESS_SECRET` and
   `JWT_REFRESH_SECRET` are read by the code but missing from `.env`, so auth is currently
   running on hardcoded fallback defaults. Fix before anything is deployed.)

---

## 9. Monetization (design only — not built)

Worth being able to discuss; not worth integrating Stripe for.

| Tier | Limits |
| --- | --- |
| Anonymous | 2 decks, no saving |
| Free account | 10 decks/day, save and share |
| Paid (hypothetical) | Unlimited, `Latest` priority, export formats |

The interesting part is that the free tier is defensible *because* of the cache: popular
topics cost nothing to serve twice.
