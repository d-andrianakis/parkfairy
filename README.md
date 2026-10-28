# Parkfairy

Parking marketplace: drivers search and book parking; owners list facilities and spaces;
administrators moderate the marketplace. Launches in Greek and English.

This repository is a TypeScript monorepo (pnpm workspaces + Turborepo) organised as a
modular monolith: the web app, API and worker deploy separately but share one database and
one set of domain packages.

| Path                  | What it is                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web`            | Next.js (App Router). Hosts the Better Auth handlers at `/api/auth/*` and proxies `/api/v1/*` to the API. |
| `apps/api`            | NestJS REST API under `/v1`. Verifies Better Auth sessions; owns all business rules and authorization.    |
| `apps/worker`         | BullMQ workers for scheduled and asynchronous jobs.                                                       |
| `packages/database`   | Drizzle schema, versioned SQL migrations, connection factory.                                             |
| `packages/auth`       | The single Better Auth configuration used by both web and API.                                            |
| `packages/contracts`  | Zod schemas and shared constants (locales, validation keys) for the API, web and worker.                  |
| `packages/api-client` | TypeScript client + TanStack Query helpers generated from the API's OpenAPI document.                     |
| `packages/ui`         | shadcn/ui-style components, Tailwind theme tokens, and test helpers (axe).                                |
| `packages/config`     | Shared TypeScript and ESLint configuration.                                                               |
| `tests/smoke`         | Playwright smoke suite: one spec per feature, run against production builds or a deployed environment.    |

## Project docs

- [memory.md](memory.md): decisions, conventions, open product questions, environment gotchas.
- [progress.md](progress.md): per-feature checkpoints and the Definition of Done.
- [CLAUDE.md](CLAUDE.md): how AI agents (and humans) should work in this repo.
- `.claude/skills/`: procedures (`feature-workflow`, `api-endpoint`, `db-migration`, `i18n`, `testing`, `verify`).
- `.claude/agents/`: reviewers (`security-`, `performance-`, `accessibility-`, `i18n-`, `test-reviewer`).

## Getting started

Requirements: Node 24+, pnpm 10, Docker.

```sh
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:up                      # Postgres 17 + PostGIS on :5434, Redis on :6380
pnpm db:migrate
pnpm dev                        # web :3000, API :4000 (Swagger at /docs), worker health :4100
```

Open http://localhost:3000 (redirects to `/el` or `/en` from your browser language), create an
account, and the account page shows the identity the API derived from your session cookie.

The compose file uses ports 5434 and 6380 so it does not collide with a local Postgres or Redis.
A `parkfairy_test` database is created on first start for the automated tests.

## Everyday commands

| Command                                        | Does                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                                     | Runs every app and package watcher.                                          |
| `pnpm build`                                   | Production build of everything.                                              |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Static checks (lint also rejects hardcoded UI text).                         |
| `pnpm test`                                    | Unit tests everywhere + API integration tests (against `TEST_DATABASE_URL`). |
| `pnpm test:smoke`                              | Boots the built API, worker and web, runs the Playwright smoke suite.        |
| `pnpm db:generate`                             | Creates a migration from changes in `packages/database/src/schema`.          |
| `pnpm db:migrate`                              | Applies pending migrations to `DATABASE_URL`.                                |
| `pnpm api:generate`                            | Re-emits `openapi.json` from the API and regenerates the client.             |

Run the smoke suite against a deployed environment with `SMOKE_WEB_URL` (plus `SMOKE_API_URL`,
`SMOKE_WORKER_URL` if reachable, and `SMOKE_USER_EMAIL`/`SMOKE_USER_PASSWORD` for a
pre-provisioned Greek-locale account so runs don't create users).

CI fails if the schema has unmigrated changes or the generated client is out of date, so
run `pnpm db:generate` / `pnpm api:generate` and commit the output alongside your change.

## How the pieces fit

**One identity system.** Better Auth is the only authority. The web app hosts its handlers;
the API builds the same instance from `@parkfairy/auth` purely to look sessions up in the
database on every request (no cookie cache, so sign-out and role changes apply immediately).
Clients cannot set `role`.

**Same-origin API.** Browsers call `/api/v1/*` on the web origin, which Next.js rewrites to the
API. The HTTP-only, `SameSite=Lax` session cookie therefore needs no CORS. If the API is ever
exposed on its own origin, set `API_CORS_ORIGINS`.

**Authorization is in the API.** Every route requires a session unless marked `@Public()`.
`@Roles('admin')` additionally requires two-factor authentication to be enabled. Cookie-bearing
unsafe requests must carry an `Origin` from `TRUSTED_ORIGINS` (CSRF defence). Hiding UI in the
web app is never the control.

**Security headers.** Every page gets a per-request nonce Content-Security-Policy
(`apps/web/proxy.ts`) plus HSTS, frame, and content-type protections; the API uses Helmet.

**Internationalization.** next-intl with locale-prefixed URLs (`/el`, `/en`), catalogs in
`apps/web/messages`, dates in `Europe/Athens`. Validation messages and API errors are keys or
codes that the UI translates; the user's preferred language is stored on the account.

**Contracts.** Zod schemas in `packages/contracts` are registered as named OpenAPI components.
The API documents responses with them and parses responses through them (so unlisted fields
never leak); the client in `packages/api-client` is generated from the emitted document.

**Database conventions.** UUID keys, `timestamptz` everywhere (UTC), snake_case SQL names,
enforced by a test over every table. Migrations are plain SQL in
`packages/database/migrations`, applied by Drizzle's migrator at deploy time. PostGIS and
`btree_gist` are enabled for geo search and booking exclusion constraints.

## Status

See [progress.md](progress.md). Phase 1 (foundation, authentication, i18n, security and
accessibility baselines) is in place; Phase 2 waits on the product decisions listed in
[memory.md](memory.md).
