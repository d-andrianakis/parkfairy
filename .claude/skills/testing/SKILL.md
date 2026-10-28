---
name: testing
description: How to write Parkfairy's unit tests (Vitest), API integration tests, and Playwright smoke tests, including accessibility, security and performance checks. Use when adding a feature or fixing a bug — every feature needs unit tests and a smoke test.
---

# Testing

Every feature ships with **unit tests** and a **smoke test**. A bug fix ships with a test
that fails without the fix.

## Unit tests (Vitest) — next to the code as `*.test.ts[x]`

| Where             | Environment         | Notes                                                                                  |
| ----------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `packages/*`      | node / jsdom (`ui`) | pure logic, schemas, config                                                            |
| `apps/api/src`    | node                | construct guards/controllers/services with fakes; decorators work (Oxc emits metadata) |
| `apps/worker/src` | node                | processors with a fake `db` and silent pino                                            |
| `apps/web`        | jsdom               | `renderWithProviders(ui, { locale })` from `@/test/render` uses the **real** catalogs  |

Web specifics:

- `@/i18n/navigation` is mocked globally (`test/navigation-mock.tsx`); assert on `routerMock`.
- Mock `@/lib/auth-client` per file with `vi.mock`.
- Query by role/label the way users do; assert accessible names/descriptions
  (`toHaveAccessibleDescription`) for error wiring.
- Call `expectNoAxeViolations(container)` from `@parkfairy/ui/testing/axe` for every
  component with UI (contrast is checked in smoke tests instead).
- Test at least one non-default locale (`el`) for translated output.

API integration tests (`apps/api/test/*.integration.test.ts`): real Postgres (`TEST_DATABASE_URL`),
`createTestApp()`, `signUpUser()`; cover 401 anonymous, 403/404 wrong user/owner, happy path.

## Smoke tests (Playwright) — `tests/smoke/specs/<feature>.smoke.ts`

- One file per feature; critical path only, against production builds.
- Sessions: `test.use({ storageState: SIGNED_IN_STATE })` reuses the shared account from
  `auth.setup.ts`. Don't sign up/in in new tests unless the flow _is_ the feature
  (Better Auth allows 3 sign-in/up per 10 s per IP).
- New page → add it to `accessibility.smoke.ts` (both locales).
- Security-relevant feature → extend `security.smoke.ts` (authz, CSRF, headers).
- Page with new client JS → check `performance.smoke.ts` budgets still hold.
- Locators: roles and labels; Next.js renders an empty `role=alert` route announcer, so
  filter alerts by text.
- Must also work against a deployed env: use `API_URL`/`WORKER_URL` from `support/env.ts`
  and `test.skip` when they are undefined.

## Commands

```sh
pnpm test                         # all unit + API integration tests (needs pnpm db:up)
pnpm --filter @parkfairy/web test # one package
pnpm build && pnpm test:smoke     # smoke suite (boots API, worker, web)
SMOKE_WEB_URL=https://staging.example.gr pnpm test:smoke   # against an environment
```

## Quality bar

- Assert behaviour users/clients observe, not implementation details.
- Prove a new test can fail (break the code briefly) before trusting it.
- No sleeps; use Playwright auto-waiting and `expect.poll`.
