---
name: verify
description: The full Parkfairy quality gate — format, lint, typecheck, build, migrations, schema/client drift, unit, integration and smoke tests. Run before declaring any change done or opening a PR.
---

# Verify

Run from the repo root and report each result honestly (paste failures, don't summarize them away).

```sh
pnpm db:up                       # Postgres :5434, Redis :6380 must be healthy
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm db:migrate && pnpm db:migrate   # second run must be a no-op
pnpm db:generate                 # must report "No schema changes"
pnpm api:generate                # must leave packages/api-client unchanged (git diff)
pnpm test                        # unit + API integration
pnpm test:smoke                  # Playwright: health, auth, API session, i18n, security, a11y, performance
```

If `pnpm test:smoke` fails on a port in use, stop stray dev servers on 3000/4000/4100 first.

Then:

1. Check `git status` for unintended files (no `.env`, no `test-results/`, no `.auth/`).
2. Run the review agents (`security-reviewer`, `performance-reviewer`,
   `accessibility-reviewer`, `i18n-reviewer`, `test-reviewer`) on the diff.
3. Update `progress.md` checkboxes you verified and `memory.md` with anything non-obvious.
