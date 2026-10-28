---
name: api-endpoint
description: How to add or change a NestJS endpoint in apps/api — contracts, guards, ownership checks, validation, OpenAPI, client regeneration, and tests. Use whenever you touch apps/api routes.
---

# Adding an API endpoint

## Shape

- Domain module at `apps/api/src/<domain>/` with `<domain>.module.ts`, `<domain>.controller.ts`,
  `<domain>.service.ts`. Register the module in `app.module.ts`.
- ESM: relative imports end in `.js`. Inject the DB with `@Inject(DB) db: Database`.
- Routes are versioned automatically (`/v1/...`). Health-style routes use `VERSION_NEUTRAL`.

## Authorization (the API is the only enforcement layer)

- Every route requires a session by default. Only add `@Public()` for genuinely anonymous data.
- Staff-only: `@Roles('admin')` (also requires 2FA). Never accept a role or owner id from the client.
- Resource ownership: load the resource and compare `ownerId === user.id` in the **service**;
  return 404 (not 403) when the caller may not know it exists. Write a test for the
  "another owner's resource" case.
- Cookie-authenticated writes are CSRF-checked by `OriginGuard`; webhooks must instead verify
  the provider signature over the raw body.

## Validation and responses

- Inputs: parse with the contract schema (`Schema.safeParse`) and throw
  `BadRequestException({ statusCode: 400, error: 'Bad Request', message: issues.map(i => i.message), code: 'VALIDATION_FAILED' })`;
  messages are i18n keys.
- Outputs: `return ResponseSchema.parse(data)` so unlisted fields never leak.
- Errors carry a stable machine `code` (e.g. `MFA_REQUIRED`). Clients translate codes; never
  put user-facing prose that needs translating in API errors.
- Document with `@ApiOkResponse({ schema: schemaRef(ResponseSchema) })` and error responses with
  `schemaRef(ErrorResponseSchema)`; add `@ApiCookieAuth(SESSION_COOKIE_SECURITY)` on protected controllers.
  Method names become client operation ids — make them descriptive (`getMyBookings`, not `list`).

## Data and performance

- Use Drizzle query builders (parameterized). No string-built SQL from input.
- Index every column used in WHERE/JOIN/ORDER BY for new queries; paginate list endpoints
  (cursor or limit/offset with a max); select only needed columns.
- Multi-step writes in `db.transaction(...)`; booking/inventory writes rely on DB constraints,
  never a read-then-insert check.
- Money as integer minor units + currency.

## Logging

- Use the injected pino logger; never log cookies, tokens, passwords, or full request bodies
  with personal data.

## After the code

1. `pnpm api:generate` and commit `packages/api-client/openapi.json` + `src/generated`.
2. Unit tests next to the code (`*.test.ts`) for guards/services/controllers with fakes.
3. Integration test in `apps/api/test/*.integration.test.ts` for authz paths (anonymous → 401,
   wrong owner → 404/403, happy path) using `createTestApp` / `signUpUser`.
4. Smoke coverage via the `testing` skill.
