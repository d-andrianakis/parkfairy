# Parkfairy: working agreement

Parking marketplace monorepo (Next.js 16 web, NestJS 12 API, BullMQ worker, Postgres/PostGIS,
Better Auth). See [README.md](README.md) for setup.

## Before you start

1. Read [memory.md](memory.md): decisions, conventions, and environment gotchas.
2. Read [progress.md](progress.md): what is done, what is next, and the Definition of Done.
3. For Next.js APIs, trust `apps/web/node_modules/next/dist/docs/` over memory. Next 16
   differs from older versions (e.g. `proxy.ts` replaces `middleware.ts`).

## Non-negotiables for every change

Secure, performant, accessible (WCAG 2.2 AA), internationalized (`el` + `en`), and covered
by **unit tests and a smoke test**. A feature is not done until every Definition of Done box
in progress.md is ticked.

## How to work

- New feature or endpoint: use the **feature-workflow** skill. It sequences the
  **db-migration**, **api-endpoint**, **i18n** and **testing** skills.
- Before saying work is finished: run the **verify** skill, then the review agents
  `security-reviewer`, `performance-reviewer`, `accessibility-reviewer`, `i18n-reviewer` and
  `test-reviewer` on the change, and fix what they find.
- When you finish: tick the boxes in progress.md you actually verified, and add anything
  non-obvious you learned to memory.md (dated, with the why).

## Commands

```sh
pnpm db:up && pnpm db:migrate   # local Postgres (5434) + Redis (6380)
pnpm dev                        # web :3000, API :4000 (/docs), worker :4100
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm test:smoke   # Playwright smoke suite against production builds
pnpm db:generate                # after schema changes; commit the SQL
pnpm api:generate               # after API contract changes; commit the client
```

## Hard rules

- Authorization lives in the API (guards + service-level ownership checks). Hiding UI is not a control.
- No user-visible literal strings in components. Use the message catalogs.
- No floats for money; no timestamps without time zone; no edits to applied migrations.
- Never weaken the CSP, rate limits, or origin checks to make a test pass. Fix the cause.
- Don't commit or push unless asked.
