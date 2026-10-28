# Project memory

Things that are true about this project and not obvious from the code. Read this before
starting work; add to it when you learn something the next person (or agent) would
otherwise rediscover the hard way. Keep entries short, dated, and with the _why_.
Feature status lives in [progress.md](progress.md), not here.

## Product context

- Parking marketplace for Greece/EU: drivers book spots, owners list facilities, admins
  moderate. Source plan: `parking-marketplace-plan.md` (kept outside the repo).
- Launch locales: Greek (`el`, default) and English (`en`). Time zone `Europe/Athens`.
- Non-negotiables for every feature: **secure, performant, accessible (WCAG 2.2 AA),
  internationalized**, with **unit tests and a smoke test**. See the Definition of Done
  in [progress.md](progress.md).

## Open product decisions (block Phase 2+ schema work)

From plan §15, still unanswered as of 2026-10-28:

1. Pooled capacity interchangeable across spots, or separated by type/feature?
2. Booking granularity; minimum/maximum duration.
3. Charge immediately or authorize/capture? Hold duration and late-payment policy.
4. Cancellation/refund policy; when owners become eligible for payout.
5. Owners: individuals, businesses, or both?
6. Exact Stripe Connect funds flow and Greek/EU compliance obligations.

## Architecture decisions

- **2026-10-28 · One identity system.** Better Auth only. The web app hosts `/api/auth/*`;
  the API builds the _same_ instance from `@parkfairy/auth` just to verify sessions, with
  `disableRefresh` (only the web app can send the refreshed cookie back). No cookie cache:
  sign-out and role changes must apply on the next request.
- **2026-10-28 · Same-origin API.** Browsers call `/api/v1/*` on the web origin; Next.js
  rewrites to Nest. No CORS needed. If the API is ever exposed directly, set `API_CORS_ORIGINS`.
- **2026-10-28 · Roles.** `users.role` is only `user | admin` (platform staff). Owner
  capability will come from owner profiles (Phase 2), so one account can drive and own.
  Admin routes also require `twoFactorEnabled`.
- **2026-10-28 · No Better Auth admin plugin.** Privileged actions go through the Nest API
  so they get authorization checks and audit logs in one place.
- **2026-10-28 · Contracts are Zod.** `packages/contracts` schemas are registered as named
  OpenAPI components; the API parses responses through them (strips unlisted fields); the
  client in `packages/api-client` is generated from the emitted document (committed; CI
  checks drift). `nestjs-zod` was not used because it does not support NestJS 12.
- **2026-10-28 · Validation messages are i18n keys**, never English (`VALIDATION_MESSAGES`
  in contracts → `Validation.*` in the catalogs). API error bodies carry a stable `code`;
  UIs translate codes, never display server text.
- **2026-10-28 · Strict nonce CSP.** `apps/web/proxy.ts` sets a per-request nonce. Cost:
  every page renders per request (no static HTML caching). Accepted for security; revisit
  for marketing pages if needed. `style-src` allows `'unsafe-inline'` because React style
  attributes cannot carry nonces.
- **2026-10-28 · Locale stored on the user** (`users.locale`, set at sign-up and when
  switching language) so emails/notifications can be localized later.

## Conventions

- **Data:** UUID PKs, `timestamptz` (UTC instants), snake_case SQL, money as integer minor
  units + currency code, never floats. Enforced by
  `packages/database/src/schema/conventions.test.ts` for every table.
- **Migrations:** edit `packages/database/src/schema`, run `pnpm db:generate`, review the
  SQL, commit it. Never edit an applied migration. CHECK constraints for enums are built
  from the same constants the app uses (`SUPPORTED_LOCALES`, `USER_ROLES`).
- **API:** every route needs a session unless `@Public()`. `@Roles('admin')` adds MFA.
  Ownership checks belong in services, never trust client-supplied owner/role IDs.
  Business logic in services, not controllers.
- **Web:** all user-visible text comes from `apps/web/messages/*.json` (lint rule
  `i18next/no-literal-string`). Use `@/i18n/navigation` (`Link`, `useRouter`, `redirect`),
  never `next/link` / `next/navigation` directly. Format dates/numbers/currency with
  next-intl's formatter (zone `Europe/Athens`), never `toLocaleString` without a locale.
- **Accessibility:** labelled inputs via `FormField` (hint + error wired to
  `aria-describedby`), inline links underlined, one `h1` per page, `<main id="main-content">`
  comes from the layout (pages render content only).
- **Tests:** unit tests sit next to the code (`*.test.ts[x]`), integration tests needing
  Postgres in `apps/api/test/*.integration.test.ts`, browser smoke tests in
  `tests/smoke/specs/<feature>.smoke.ts`.

## Gotchas and environment quirks

- **Ports:** compose maps Postgres → 5434 and Redis → 6380 because this dev machine already
  runs another project's Postgres on 5432 and a Redis service on 6379. Don't stop those.
- **Docker restarts:** containers use `restart: unless-stopped`; if tests fail with
  `ECONNREFUSED`, run `pnpm db:up`.
- **No SWC on this machine:** `@swc/core` 1.16 refuses to load its native binary when `C:\`
  grants Authenticated Users modify rights (a common Windows default). Consequences:
  Nest tests use Vite/Oxc decorator metadata (`apps/api/vitest.config.ts`), and the web app
  does **not** use `next-intl/plugin` (it eagerly imports @swc/core); `next.config.ts` sets
  the `next-intl/config` Turbopack alias itself.
- **Root `.env` in Next.js:** `@next/env` caches its first load, and Next forwards Node flags
  into `NODE_OPTIONS` where `--env-file` is rejected. `next.config.ts` therefore calls
  `process.loadEnvFile` (existing env vars win).
- **404s:** the root layout lives under `[locale]`, so unmatched URLs are rendered by
  `app/global-not-found.tsx` (`experimental.globalNotFound`). A `notFound()` thrown _inside_
  a page still returns 404 but its HTML is a shell the client fills in (Next.js limitation
  with a dynamic root layout); crawlers get 404 + `noindex`.
- **Better Auth does not validate enum `additionalFields`.** `locale: "xx"` reached the DB.
  Validation now happens in `databaseHooks` (`withSupportedLocale`). Do the same for any
  new enum-like user field.
- **Better Auth rate limits** sign-in/sign-up at 3 requests / 10 s per IP and path. The
  smoke suite shares one account (`auth.setup.ts`) to stay under it. Limits are in-memory
  per instance until moved to Redis (see progress.md).
- **Better Auth client IP** comes from `x-forwarded-for` and is trusted only as a single IP
  unless `advanced.ipAddress.trustedProxies` is set. Configure it for the real proxy chain
  before launch, otherwise rate limiting can be bypassed or disabled.
- **Zod JIT vs CSP:** Zod 4 probes `new Function`; the browser blocks it and reports a CSP
  violation. The web client sets `z.config({ jitless: true })` in `app/providers.tsx`.
- **Next 16 dev writes `apps/web/AGENTS.md`** pointing agents at `node_modules/next/dist/docs`.
  Keep it committed (it is re-created otherwise). Those docs are the authority for Next 16
  APIs, which differ from older training data (`proxy.ts` replaces `middleware.ts`).
- **Known advisory (2026-10-28):** `pnpm audit` reports a _moderate_ esbuild dev-server issue
  (GHSA-67mh-4wv8-2f99) via drizzle-kit's deprecated `@esbuild-kit` loader. Dev-time only, and
  we never run esbuild's dev server, so it's not exploitable here. CI fails on high/critical only.
- **TypeScript is pinned to 6.0.x:** typescript-eslint and @nestjs/swagger don't support
  TS 7 yet. **ESLint is pinned to 9.x:** eslint-config-next pulls eslint-plugin-import,
  which doesn't support ESLint 10.

## Performance baselines

- 2026-10-28: first-visit JS (compressed) `/en` 218 KiB, `/en/sign-in` 233 KiB. Budget in
  `tests/smoke/specs/performance.smoke.ts` is 250 KiB; raise only with a reason here.

## Translation notes

- Greek copy was written by the developer tooling, not a native translator. Have a native
  speaker review `apps/web/messages/el.json` before launch (tracked in progress.md).
- Language names are always shown in their own language (`LOCALE_ENDONYMS`).
