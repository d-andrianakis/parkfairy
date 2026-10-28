---
name: db-migration
description: How to change the Postgres schema safely with Drizzle — conventions, constraints, indexes, PostGIS, generating and reviewing migrations. Use for any change under packages/database.
---

# Database changes

## Conventions (enforced by `packages/database/src/schema/conventions.test.ts`)

- Table per file group under `packages/database/src/schema/`, exported from `schema/index.ts`.
- `id: uuid().primaryKey().defaultRandom()`, snake_case names, `timestamp(..., { withTimezone: true })`.
- Money: `integer` minor units (or `numeric` with explicit scale) **plus** a `currency` char(3). Never `real`/`double`.
- Enum-like text columns get a CHECK constraint built from the shared constant
  (see `sqlList(...)` in `schema/auth.ts`), so the DB and the app agree.
- Foreign keys with explicit `onDelete`. Financial and audit tables never cascade-delete.
- Times of day / recurring schedules: store local time + the facility's IANA zone; store
  instants as `timestamptz`.

## Integrity first

- Encode invariants as constraints (unique, check, exclusion), not only in code.
- Double-booking prevention: `tstzrange` reserved intervals with an exclusion constraint
  `EXCLUDE USING gist (unit_id WITH =, reserved WITH &&)` (btree_gist is installed). Use half-open `[start, end)`.
- Geospatial: `geography(Point, 4326)` with a GiST index for distance queries.
- Add indexes for every new query path; partial indexes for status filters.

## Workflow

1. Edit the schema.
2. `pnpm db:generate` (optionally `--name <change>` via `pnpm --filter @parkfairy/database exec drizzle-kit generate --name ...`).
   For things Drizzle can't express (exclusion constraints, PostGIS functions, backfills), create a
   custom migration: `drizzle-kit generate --custom --name <change>` and write the SQL.
3. **Read the SQL.** Check for table rewrites/locks on large tables, NOT NULL without defaults,
   destructive drops. Prefer expand → migrate → contract for renames.
4. `pnpm db:migrate` locally, then run it again (must be a no-op).
5. `pnpm --filter @parkfairy/database test` (conventions + journal).
6. Never edit a migration that has been applied anywhere; add a new one.

## If Better Auth tables change

- They must match the plugins in `packages/auth`. Better Auth does **not** validate enum
  `additionalFields`; add validation in `databaseHooks` (see `withSupportedLocale`).
