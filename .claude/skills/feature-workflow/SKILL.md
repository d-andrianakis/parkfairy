---
name: feature-workflow
description: End-to-end procedure for building any Parkfairy feature (new screen, endpoint, table, job) so it ships secure, performant, accessible, internationalized, and with unit + smoke tests. Use at the start of every feature or non-trivial change.
---

# Feature workflow

Follow these steps in order. Skip a step only if the feature truly does not touch that layer,
and say so in your summary.

## 0. Orient

- Read `memory.md` and `progress.md`. Find the feature's checklist in progress.md; if it has
  none, add one by copying the Definition of Done.
- Check memory.md "Open product decisions". If the feature depends on an unanswered one,
  stop and ask instead of guessing.

## 1. Contract first

- Add or extend Zod schemas in `packages/contracts/src/` and register response/input schemas in
  `contractsRegistry` with a stable `id`.
- Validation messages must be keys from `VALIDATION_MESSAGES` (add new keys there and to
  **both** catalogs in `apps/web/messages/`).
- Add unit tests in `packages/contracts/src/*.test.ts` for the new schemas.

## 2. Data (if needed): use the `db-migration` skill

- Schema in `packages/database/src/schema/`, `pnpm db:generate`, review the SQL, add
  constraints and indexes for the queries you will run.

## 3. API: use the `api-endpoint` skill

- Module/controller/service under `apps/api/src/<domain>/`. Authorization in guards and
  service-level ownership checks. Parse responses through the contract.
- `pnpm api:generate` to refresh the OpenAPI document and the client.

## 4. Web

- Pages under `apps/web/app/[locale]/…`, server components by default; client components
  only where interaction needs them.
- Data: generated TanStack Query options from `@parkfairy/api-client/react-query`.
- Text: the `i18n` skill. Navigation via `@/i18n/navigation` only.
- Forms: React Hook Form + `zodResolver(<contract schema>)`, `FormField` for inputs,
  `useValidationMessage` for errors, `FormError` + `authErrorKey`-style code mapping for server errors.
- Accessibility: one `h1`, labelled controls, visible focus, no colour-only meaning,
  keyboard-operable, status/alert roles for async feedback.
- Performance: keep data fetching on the server where possible, avoid shipping large
  libraries to the client, check the JS budget in the smoke suite.

## 5. Worker (if needed)

- New `QueueProcessor` in `apps/worker/src/processors/`, registered in `main.ts`.
  Jobs must be idempotent and fail loudly on unknown names.

## 6. Tests: use the `testing` skill

- Unit tests for every new module/component/guard.
- One smoke spec `tests/smoke/specs/<feature>.smoke.ts` (or extend the matching one)
  covering the critical path; add new pages to `accessibility.smoke.ts`.

## 7. Verify and review

- Run the `verify` skill.
- Run the review agents on the change: `security-reviewer`, `performance-reviewer`,
  `accessibility-reviewer`, `i18n-reviewer`, `test-reviewer`. Fix findings or record why not.

## 8. Close out

- Tick only verified boxes in `progress.md`.
- Add non-obvious learnings to `memory.md` (dated, with the why).
- Summarize what changed, how it was verified, and what is still open.
