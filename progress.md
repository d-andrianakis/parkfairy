# Progress

Checkpoints for every feature, phase by phase (from the architecture plan). Tick a box only
when it is true _and verified_; link the evidence (test file, PR) where useful. Decisions
and gotchas go in [memory.md](memory.md).

## Definition of Done (applies to every feature)

Copy this list under a new feature and tick it off:

- [ ] **Implemented** behind the API's authorization rules (no client-trusted roles/IDs)
- [ ] **Unit tests** next to the code (`*.test.ts[x]`) for logic, guards, components
- [ ] **Smoke test** `tests/smoke/specs/<feature>.smoke.ts` covering the critical path
- [ ] **Security** review (`security-reviewer` agent): authz, input validation, CSRF, secrets, logging of PII
- [ ] **Performance** review (`performance-reviewer` agent): queries/indexes, payload & JS budget
- [ ] **Accessibility** (`accessibility-reviewer` agent): WCAG 2.2 AA, axe clean in smoke suite, keyboard path
- [ ] **i18n** (`i18n-reviewer` agent): no literal UI text, `el` + `en` catalogs complete, Intl formatting
- [ ] **Contracts & docs**: OpenAPI/client regenerated, migrations reviewed, memory.md updated if something non-obvious was learned

Legend: `[x]` done · `[ ]` not done · `[~]` partially done (say what is missing)

---

## Phase 1: Foundation and authentication

### 1.1 Monorepo and tooling

- [x] pnpm workspaces + Turborepo (`apps/*`, `packages/*`, `tests/*`)
- [x] Shared TS / ESLint / Prettier config (`packages/config`)
- [x] Docker Compose: Postgres 17 + PostGIS 3.6, Redis 8.8
- [x] CI: format, lint, typecheck, build, migrations, drift checks, unit + smoke tests
- [x] Dependency audit job + Dependabot
- [ ] Staging/production environments, secret store, deploy pipeline

### 1.2 Database and migrations

- [x] Drizzle schema + versioned SQL migrations, runtime migrator (`pnpm db:migrate`)
- [x] PostGIS and btree_gist enabled first
- [x] Unit tests: conventions for every table (`schema/conventions.test.ts`), journal integrity (`migrations.test.ts`)
- [x] Smoke: API readiness proves DB connectivity (`platform-health.smoke.ts`)
- [x] CI: migrations apply twice (idempotent) and schema has no unmigrated changes

### 1.3 Authentication (Better Auth)

- [x] Email + password sign-up / sign-in / sign-out; UUID ids; role not client-settable
- [x] Two-factor verification at sign-in (TOTP)
- [x] 2FA enrolment UI on the account page (password re-check, QR + typed key, first code,
      backup codes once, turn off with password); other sessions end when it changes; backup
      codes usable at sign-in; lockout message with the wait. Unit tests, integration test
      against real Better Auth (`two-factor.integration.test.ts`), `two-factor.smoke.ts`
      (including "password alone is no session" and a 320 px Greek check); reviewed twice
- [~] Email verification + password reset: done and tested end to end against the local
  outbox (1.14). Missing: one real send, which needs a Resend key and a verified domain
- [x] Unit tests: auth config (`packages/auth/src/index.test.ts`), forms (`sign-in-form`, `sign-up-form`, `two-factor-form` tests)
- [x] Smoke: `auth.smoke.ts`
- [x] Security: shared password policy, locale validation hook, open-redirect guard, CSRF origin check (Better Auth + API)
- [x] Rate limits backed by Redis (API throttler + Better Auth, atomic Lua; Better Auth falls
      back to per-process memory and the API throttler lets requests through when Redis is
      down; hashed/hash-tagged keys; tested against real Redis, including sharing across
      instances, expiry, window reset and an unreachable Redis). `TRUSTED_PROXIES` and
      `TRUST_PROXY` are required in production; real values come with the deployment (1.1)
- [x] Accessibility: axe-clean forms, errors linked via `aria-describedby`, translated alerts
- [x] Accessibility follow-ups (2026-10-29): failed submits are announced even when focus
      cannot move (`useInvalidSubmitStatus`, cleared on a valid submit); the submit button
      stays focusable while submitting (`aria-disabled`, repeats ignored); tested on the
      sign-in, sign-up, two-factor and 2FA-settings forms; forms POST even before hydration

### 1.4 API session verification and contracts

- [x] Global `AuthGuard` (`@Public`, `@Roles('admin')` + MFA), `OriginGuard` (CSRF)
- [x] `/v1/me` parsed through `MeResponseSchema`; OpenAPI emitted; client generated; CI drift check
- [x] Unit tests: guards, controllers, OpenAPI bridge; integration: `apps/api/test/auth.integration.test.ts`
- [x] Smoke: `api-session.smoke.ts`

### 1.5 Platform: health, logging, worker

- [x] API `/health` + `/health/ready`; worker `/health` + `/health/ready`
- [x] Structured logs with request IDs (pino); cookies/headers not logged
- [x] Worker skeleton with scheduled `maintenance` queue (heartbeat)
- [x] Unit tests: health controller, worker processor + env
- [x] Smoke: `platform-health.smoke.ts`
- [ ] Sentry + alerting (booking/webhook failures, queue backlog)
- [~] Graceful worker shutdown on Linux: `check:shutdown` runs in CI after the smoke suite
  (skips on Windows); passes once CI has run it. The shutdown order (jobs finish, then queues,
  then the database; a second signal ignored) is unit-tested (`src/shutdown.test.ts`)

### 1.6 Internationalization

- [x] next-intl with `/el` and `/en` prefixes, Accept-Language negotiation, `hreflang` alternates
- [x] Catalog parity + ICU argument + coverage tests (`messages/catalogs.test.ts`)
- [x] Language switcher (links, endonyms, `aria-current`), preference saved on the account
- [x] Lint rule forbids literal UI text
- [x] Smoke: `i18n.smoke.ts`
- [ ] Native-speaker review of Greek copy. The wording questions raised so far were settled by
      the product owner on 2026-10-31 (memory.md, Translation notes; the edits are in 1.15).
      Still to read through: the catalogue (`Home`, `SearchForm`, `Search`, `Listing`,
      `Features`, `Cities`, `Error`, new `Validation` keys) and `Theme.*`. Tests hard-code these
      strings. Also: `Forms.*`, `TwoFactorSettings.*`, `AuthErrors.INVALID_PASSWORD` /
      `ACCOUNT_TEMPORARILY_LOCKED`, `Validation.startTooFar` / `durationTooLong` /
      `timeNotOnStep`, `Search.resultsTitle`, the colon pattern in `Search.titleArea` and
      `Listing.moreNear`, `Listing.localTime`, and the plain hyphen CLDR puts in multi-day
      Greek ranges. Added 2026-10-30: `SignUp.sent*`/`resend*`, `SignIn.forgotPassword`,
      `AuthErrors.INVALID_TOKEN`, `ForgotPassword.*`, `ResetPassword.*`, `VerifyEmail.*`,
      `Email.*`. Added 2026-10-31: `Forms.showPassword`, the longer
      `AuthErrors.INVALID_EMAIL_OR_PASSWORD`, "ημερομηνία άφιξης" in `Validation.startTooFar`,
      "κωδικού πρόσβασης" in `ResetPassword.submit`, `ResetPassword.metaTitle`,
      `Email.existingAccount.body`
- [x] Localized emails: rendered in the language stored on the account (1.14)

### 1.7 Security baseline

- [x] Nonce-based CSP (`proxy.ts`), HSTS, frame/nosniff/referrer/permissions headers
- [x] Helmet on the API; body size limits; global rate limit (in-memory)
- [x] Unit tests: CSP builder, safe redirects; smoke: `security.smoke.ts` (headers, nonce on every script, no CSP violations, cookie flags, CSRF)
- [ ] Security review of deployment (TLS, secret rotation, backups) → Phase 6

### 1.8 Accessibility baseline

- [x] Skip link, single `main` landmark, `lang` per page, focus-visible styles
- [x] axe in unit tests (jsdom) and smoke tests (real browser, both locales, WCAG 2.2 AA)
- [x] Smoke: `accessibility.smoke.ts`
- [ ] Manual screen-reader pass (NVDA + VoiceOver) before launch

### 1.9 Performance baseline

- [x] First-visit JS and request budgets; API readiness latency budget (`performance.smoke.ts`)
- [x] Trim client JS: header session rendered on the server (no Better Auth client outside
      auth pages; `/en` 224 → 212 KiB); client components get only their message namespaces
      (`ClientMessages`)
- [ ] Lighthouse/Core Web Vitals monitoring in production

### 1.10 Design system: shadcn/ui, palette, light/dark theme

- [x] shadcn monorepo setup (`components.json` in `packages/ui` + `apps/web`); canonical
      `new-york-v4` button, card, input, label, alert, field, separator, dropdown-menu
- [x] Web UI on shadcn: `FormField` → Field, forms → FieldGroup, locale links → Button,
      API error → Alert, theme menu → DropdownMenu
- [x] Palette tokens (blue primary, violet highlight, status fills, slate neutrals), light + dark
- [x] Theme: cookie → server-rendered `<html class>`, "system" via `prefers-color-scheme`,
      no script; header menu (Light / Dark / System)
- [x] Unit tests: token contrast both themes incl. focus/invalid states (`tokens.test.ts`),
      `lib/theme.test.ts`, `theme-toggle.test.tsx` (cold + loaded menu), `form-field.test.tsx`,
      `site-header.test.tsx`, `api-identity.test.tsx` error state
- [x] Smoke: `theme.smoke.ts` (OS follow, explicit choice server-rendered incl. 404 and other
      locale, cookie flags, no-JS paint, keyboard, Escape, forced colours, reduced motion,
      tampered cookie, CSP); dark-mode axe + 320px reflow in `accessibility.smoke.ts`; phone
      CLS in `performance.smoke.ts`
- [x] Security review: no findings to fix; `theme` cookie added to the Phase 6 cookie inventory
- [x] Performance review: theme menu lazy-loaded on intent (`/en` 219 KiB, `/en/sign-in`
      236 KiB, budget stays 250 KiB); phone header reserves the account row (CLS 0)
- [x] Accessibility review: menu focus ring, solid invalid-field ring, readable invalid text
      in dark mode, forced-colors focus, reduced motion, no unnamed field groups, account page
      reflow at 320px, destructive red darkened (alert text failed axe)
- [x] i18n review: catalogs complete; `no-literal-string` now also lints `packages/ui`; new
      Greek strings flagged for the native-speaker pass in 1.6
- [x] Test review: gaps closed (see unit/smoke lines above)
- [ ] Manual checks the reviews asked for: NVDA + Chrome and VoiceOver + Safari on the theme
      menu; Windows 11 contrast theme in Edge (header, inputs, menu focus); iOS VoiceOver /
      TalkBack swiping out of the non-modal menu
- [x] Render the header's signed-in state on the server (`getSession` in the layout, cached
      per request; done with 1.9)

### 1.11 Public catalogue with demo data (2026-10-29)

Anonymous browsing and search of parking, ahead of owner onboarding (Phase 2) and booking
(Phase 3). Decisions #1 (named spaces) and #2 (30-minute steps, 30 min to 30 days) answered.

- [x] Implemented: `parking_locations` (geography point, area, status, owner-language
      content), named `parking_spaces`, weekly `parking_opening_hours` (exclusion constraint);
      public API `/v1/parking/featured|search|:slug` (drafts hidden, same 404 for unknown)
- [x] Search: curated areas or "use my location", Athens date + half-hour times, open for the
      whole stay, nearest first, server-side total (hourly pro rata, daily cap)
- [x] Web: home page (hero search, popular areas, featured listings, how it works), search
      results, listing page (hours, spaces, availability + total); all shadcn
- [x] Demo data + demo account: `pnpm db:seed` (local only); credentials in GETTING_STARTED.md
- [x] Unit tests: contracts (time/DST, search rules), DB conventions + EWKB, API pricing,
      opening hours, controller, seed guard; web search params, form, near-me, cards, hours
- [x] Integration: `apps/api/test/parking.integration.test.ts` (anonymous access, drafts,
      400 keys, availability, constraints)
- [x] Smoke: `parking.smoke.ts`; catalogue pages in `accessibility.smoke.ts` (axe light/dark,
      320px reflow); `/en/search` in the JS budget
- [x] Security review: fixed an unauthenticated endless loop (year-9999 window → 365-day
      horizon, bounded day walk), seed guard bypass (`?host=`, plus a database marker),
      visitor IP forwarded for rate limits, API call timeouts, coordinates redacted from logs,
      per-route `@Public()`, slug/time-zone/length constraints, loopback-only dev ports
- [x] Performance review: search no longer drops open listings (KNN batches), featured picks
      rows before aggregating, detail queries in parallel, metadata + page share one request,
      featured cached, statement timeout, spaces list capped; JS budget and CLS cover the
      catalogue pages
- [x] Accessibility review: card focus in forced colors, near-me keeps focus and its live
      region, field roles fixed on the client (RSC boundary), focus moves to main after
      client navigation, descriptive search titles, error summary with links, "From Date"
      names, static availability not an alert, no untranslated browser bubbles
- [x] i18n review: 24-hour Greek times (24:00 at midnight), language switch keeps the
      search, translated error page and "unavailable" states, wording fixes, plurals,
      distances in metres; new Greek strings listed for the native pass (1.6)
- [x] Test review: gaps closed (DST at search level, horizon, constraints, suspended and
      inactive spaces, ordering/radius, seed idempotency and marker, API-failure paths, smoke
      for empty/closed/no-JS/language switch/forced colors; demo-data skips per test)
- [ ] Production config before launch: `TRUST_PROXY` = the web servers' addresses (never a
      hop count), `TRUSTED_PROXIES` = the proxy chain, the first proxy overwriting/appending
      `X-Forwarded-For` (memory.md, rate-limit keys). The apps now refuse to start in
      production without them. Also for email (1.14): `RESEND_API_KEY` and `EMAIL_FROM` on a
      verified domain, Resend click tracking off (it would rewrite one-time links), access logs
      without query strings (confirmation tokens hold the address), a stop grace of at least
      20 s (`after()` work), and check the real limit (`ratelimit-limit`) against the 2 sends
      a second assumed in `transport.ts`
- [ ] At scale: opening-hours filter in SQL (minute-of-week multirange) and short-TTL search
      caching (perf review findings 2/6, deferred until real inventory)
- [x] Contracts & docs: OpenAPI + client regenerated, migrations 0003/0004 reviewed, memory.md

### 1.12 Second review round (2026-10-29)

- [x] Security: Better Auth rate-limit keys hashed (attacker-sized paths); memory fallback
      for sign-in/2FA limits when Redis fails; proxy settings required in production and the
      `TRUST_PROXY` guidance corrected; Redis Cluster-safe keys; forms POST before hydration;
      the language switcher carries only search keys and `next`; the seed refuses session
      options; the test Redis flush is guarded
- [x] Sessions no longer expire 7 days after sign-in regardless of activity (server
      components could not set the refreshed cookie; refresh now goes through the handler)
      and a failed session lookup renders the page signed out instead of an error
- [x] Performance: first-visit JS 212 → 169 KiB on catalogue pages, 239 → 228 KiB on sign-in
      (zod, contract schemas and React Query out of the root layout); Redis outages no longer
      add 500 ms per request once connected (and, after round 3, neither does a hung
      connection or a Redis that is down at start-up on the web); pool connection-wait limits
      and statement timeouts; API latency budget for search and listing in the performance
      smoke
- [x] Accessibility: focus after a language switch, none on Back/Forward; error page focuses
      its heading and keeps focus on retry; error-summary links name their field; stay ranges
      read "to" instead of a skipped dash; stale failed-submit messages cleared
- [x] i18n: result titles in one ICU message; whole-sentence plurals; 996 m reads "1 km";
      root-layout failures get a translated screen (`app/global-error.tsx`); component tests
      use each subtree's real namespace list
- [x] Tests: ordering and >100-candidate search, forwarding headers, real-Redis sharing,
      outage and expiry, env parsing, worker shutdown order, sign-in/sign-up repeat submits,
      route focus, error screens, stay range; smoke covers 2FA end to end and keeps the stay
      window across a language switch
- [x] Listing spaces capped in the API at 48 (`LISTING_SPACES_LIMIT`, in the contract);
      `spaceCount` carries the total. The query still reads every row, fine to about 2,000 spaces
- [x] Rate-limit scripts run by EVALSHA, falling back to the full text on NOSCRIPT (tested
      against real Redis after `SCRIPT FLUSH`)
- [ ] Deferred: opening-hours check in SQL; top-48 spaces in SQL (needs an ICU numeric
      collation; worth it above about 10,000 spaces in one listing)
- [x] Decided 2026-10-31: a stay that crosses a DST change is priced on real elapsed time, as it
      is today, so the spring-forward night stays an hour cheaper than the wall clock suggests
- [x] Re-review of this round by the five review agents (findings fixed in 1.13)

### 1.13 Third review round (2026-10-30)

- [x] Security: turning two-factor on or off ends the user's other sessions; one factor row
      per user (migration 0006); `TRUSTED_PROXIES` entries validated and `none` documented
      precisely; `TRUST_PROXY=true` refused in production; no session token in logs;
      two-factor changes from another site refused (smoke)
- [x] Backup codes accepted at sign-in (they were promised but unusable)
- [x] i18n: the lockout message (was masked by the generic 429) says how long to wait;
      Greek two-factor terms consistent; "Στάθμευση στην περιοχή {area}" titles; stays next
      year show the year; the root error screen always has its strings
- [x] Accessibility: two-factor buttons wrap at 320 px (Greek overflowed); focus returns
      after an awaited change; backup codes never split; password managers get the username;
      root error screen focuses its heading
- [x] Performance: Redis socket timeout on both clients, web never queues commands;
      two-factor steps load on intent; the account page keeps its layout while the API
      answers; API statement timeout 3 s (below the web's 4 s); account page in the JS and
      CLS budgets
- [x] Tests: RFC 6238 vectors, QR orientation, unhandled rejections, shutdown failure exit
      code, wrong password while turning off, cancel at the QR step, proxy validation
- [x] No more waiting between local smoke runs: each worker is a visitor of its own
      (`VISITOR_HEADERS`); two runs in a row pass
- [ ] Deferred: zod-free subpath for the form limits (2–3 KiB on auth pages; low value)

### 1.14 Account emails (2026-10-30)

- [x] **Implemented:** sign-in needs a confirmed address; forgotten-password flow; four
      localized emails (`apps/web/lib/email`); Resend transport with idempotency, pacing and
      `Retry-After`; file outbox on this machine only; start-up check (`instrumentation.ts`);
      unconfirmed accounts deleted after 7 days (worker); migration 0007 (three indexes)
- [x] **Unit tests:** contracts, auth options, email render, delivery, transport, env, forms,
      focus heading, language switcher, space list, worker job
- [x] **Integration:** `account-email.integration.test.ts` (real Better Auth and Postgres, but
      origin checks and rate limits are off under `NODE_ENV=test`, see memory.md)
- [x] **Smoke:** `account-email.smoke.ts` (147 tests in the suite on the final build, run twice;
      beside `pnpm dev` on other ports, so `pnpm test:smoke` itself runs first in CI),
      off-site link checks in `security.smoke.ts`, new pages in the accessibility and JS budgets
- [x] **Security review:** fixed sign-up oracles (locale, NUL in the name, image), saved reset
      links surviving a reset, alias bypass of the recipient cap, site-wide budgets, confirmation
      by button (scanners), unconfirmed-account retention, `no-referrer` header. Open items below
- [x] **Performance review:** site budget now per clock hour (the rolling window never reset
      under steady traffic), pacing, indexes, JS budget extended; first-visit JS 228 KiB
- [x] **Accessibility review:** titles per state, heading focus ring, wrapping buttons, typed
      address carried to the reset form (3.3.7), instructions leave with the form, email colours
- [x] **i18n review:** ICU plurals, Greek wording, `κωδικός πρόσβασης` everywhere (bare κωδικός
      means the two-factor code), `lang` on email content; strings listed in 1.6
- [x] **Test review:** gaps closed (start-up guard against a real `next start`, off-site
      redirects, expiry, three-way enumeration comparison, Redis down, HTML body)
- [x] **Contracts & docs:** no API contract change for email; migration 0007 reviewed;
      GETTING_STARTED, README, memory.md
- [ ] A real send through Resend, and the emails in Gmail, Outlook and Apple Mail, dark mode
      included (colours are fixed, but some clients recolour anyway)
- [ ] Manual NVDA and VoiceOver pass on the panels (heading focus, `FormError` insertion, busy
      button, Greek voice on a Latin address)
- [ ] Support process for a planted second factor: someone who signs up with a stranger's
      address, has it confirmed and enrols TOTP leaves the owner locked out after a reset
      (needs the owner to press the button now, so unlikely; no self-service recovery exists).
      Decided 2026-10-31: support removes it after an identity check (#13, built in Phase 5)
- [ ] Accepted for now, revisit before launch: reset tokens in URLs reach proxy logs (the
      production config in 1.11 keeps query strings out of access logs). The other items once
      listed here are to be fixed before launch: see 1.15

### 1.15 Follow-ups from the decisions form (2026-10-31)

The answers are in memory.md (Open product decisions, Translation notes).

- [x] **Greek edits:** every decision is in `el.json`, and `catalogs.test.ts` pins the settled
      terms. `ResetPassword.title` also became Επαναφορά κωδικού πρόσβασης; its `metaTitle` is
      Νέος κωδικός πρόσβασης (second wording round)
- [x] **Sign up then sign in** gets one answer, identical to the byte
      (`account-email.integration.test.ts`, `account-email.smoke.ts`), and so do two sign-ups
      at once, which the security review found also told a free address from a taken one
- [x] **Reset timing:** reset, sign-in and sign-up answers are held to `ANSWER_FLOOR_MS`
- [x] **One visitor can't spend an address's reset emails:** 3 of 6 an hour (`delivery.test.ts`;
      unit-tested only, see memory.md). Accepted: two real IPs still can
- [x] **Language switch keeps the panel**, on all three pages, with reloads and titles
- [x] **Show-password button** on all four password fields; hides after validation passes
- [x] **Unit tests**, **integration** and **smoke** on the final tree, plus 28 deliberate breaks of
      the new behaviour, each caught by a test
- [x] **Security review:** F1 (parallel sign-ups) and the sign-up and sign-in timing fixed;
      timestamps, unidentified visitors, the lingering address and the `auth.api` trap fixed
- [x] **Performance review:** no connection pinned, budgets hold, CLS placeholder added
- [x] **Accessibility review:** input replaced at hydration (serious), toggle focus ring in dark
      mode, silent waiting state, stuck panel and missed route focus fixed
- [x] **i18n review:** bare `κωδικού` on the reset button, `startTooFar`, ambiguous English fixed
- [x] **Test review:** gaps closed (floors, the two untested password fields, sign-out, waiting)
- [x] **Second form (2026-10-31):** pricing, commission and cancellation answered (memory.md #15–#17);
      wording answered and applied (memory.md, Translation notes)
- [x] **Review round before commit (2026-10-31):** a lone surrogate in a name told a free address
      from a taken one, fixed with padded names; `show` leaves the URL alone once the visitor has
      left; `?sent=1` layout shift is now in `performance.smoke.ts` on all three pages, both
      languages; reloads on all three panels; shared claim store, sign-out states and the dark
      input fill covered. Primary darkened in both themes from the design-system page
- [x] Decided (2026-11-01, product owner): `ResetPassword.submit` keeps its wording,
      `Αποθήκευση νέου κωδικού πρόσβασης`, which matches the English button and `Αποθήκευση…`
      while it saves. Added to the kept list in memory.md
- [x] WCAG 2.4.3 (2026-11-01): `FocusHeading` takes the focus only from `body` or `#main-content`,
      so someone who moved on during a slow request or load keeps their place, and a status
      message tells them instead. Unit tests, and smoke tests of a slow load and a slow request.
      All five reviews run: security and performance found nothing
- [ ] Minor: while a two-factor step's code loads, `fallback={null}` shows nothing and the button
      is already gone (`two-factor-settings.tsx`). Only reachable on a slow network, because it
      preloads on hover and focus. Fix: keep the button until the step is ready
- [ ] Manual: `FocusHeading`'s status with NVDA and VoiceOver: tab off during a slow sign-up, an
      email confirmation and a two-factor step, and check whether it doubles up with the page
      title Next.js announces
- [ ] Manual: NVDA and VoiceOver on the toggle and on a language switch at the panel; a saved
      password filling in during slow hydration (Chrome, Edge, Firefox, Safari); whether 1Password
      or Bitwarden icons cover the toggle
- [ ] Before launch: measure sign-up, sign-in and reset work on production hardware against
      `ANSWER_FLOOR_MS`
- [ ] Watch: one `ECONNRESET` on `/api/v1/me` in `account-email.smoke.ts` (once in four runs on
      2026-10-31, not reproduced, cause unknown), and one failure of
      `parking.integration.test.ts` under heavy machine load (error not captured, three clean
      runs after)

### 1.16 Date and time picker (2026-10-31)

One field for each end of a stay: day on the left, hour and half hour on the right. See memory.md.

- [x] **Until follows From (2026-11-01):** a From picked at or past Until moves Until and keeps
      the length of the stay (`StayFields`). Unit and smoke tests cover the order of picks, arrow
      keys, midnight, a refused URL and the announcement in both languages
- [x] **Emails use the primary (2026-11-01):** `#092c99`, held to `--primary` by `tokens.test.ts`
- [x] **Implemented:** `DateTimeField` and the lazy `DateTimePicker`, shadcn calendar, popover,
      scroll area and toggle group added. The search form still submits the same four fields
      and works without JavaScript
- [x] **Unit tests:** `date-time-field.test.tsx`, `date-time-field.load.test.tsx`, the ui package
- [x] **Smoke test:** `parking.smoke.ts` (mouse, keyboard, Greek, axe in both themes, forced
      colours, 320 px, far time zones, nonsense in the URL, lazy load, no JavaScript)
- [x] **Security review:** nothing found in the picker, new dependencies included. Round two: a
      crafted date past year 9999 could break the moved Until; guarded
- [x] **Performance review:** the picker stays out of first-visit JS; 2 px of shift and the wait
      on a first press fixed. Round two: the calendar no longer re-renders when only the time
      changes, a test counts its renders, and the CLS check waits for the picker field
- [x] **Accessibility review:** calendar language, "selected" in the day's name, today without
      colour, native fields back if the picker can't load, Down Arrow, arrows choose, visible
      column labels, a window switch no longer swaps the field, the calendar no longer remounts.
      Round two: quiet on repeat visits, and Until's calendar reaches a moved date. Its suggested
      visible note was declined: see memory.md
- [x] **i18n review:** calendar language, "selected" and the month navigation's name fixed. Round
      two: the announcement says departure, with the date spelled out for listeners
- [x] **Test review:** gaps closed; removing either time-zone handling now fails a test (tried).
      Round two: click-away, zero-length stays, a mangled From, half hours, both clock changes,
      far time zones, the form's wiring and `PRIMARY` against the token
- [x] **Contracts & docs:** no contract or schema change; memory.md updated
- [ ] Spring-forward night: a From of 03:00 or 03:30 with a stay of an hour or less is refused
      with the usual error (memory.md). Decide whether those times should be offered at all
- [ ] Manual: NVDA and VoiceOver on the field (how the combobox reads, short Greek dates included)
      and in the calendar, and how `SearchForm.untilMoved` sounds, including that the focus doesn't
      cut it off; closing the picker with TalkBack, which has no Escape and no close button; 400%
      zoom; the picker in Safari and Firefox (the smoke suite runs Chrome only)
- [ ] Native speaker: the new `SearchForm` strings in `el.json`, with the rest (see Translation
      notes in memory.md)

## Phase 2: Owner onboarding and inventory (decisions answered in memory.md)

### 2.1 Owner onboarding (2026-11-02)

One dashboard with milestones, worked out from what is saved, so progress can't drift and Continue
always opens the first unfinished step. Decisions #20-#23 in memory.md.

- [~] **Implemented** behind the API's authorization rules (no client-trusted roles/IDs): done and
  tested, except that the map has never run with a real token
- [x] **Unit tests** next to the code (`*.test.ts[x]`) for logic, guards, components
- [x] **Smoke test** `tests/smoke/specs/owner-onboarding.smoke.ts` covering the critical path,
      including a listing sent back and sent again
- [x] **Security** review (`security-reviewer` agent): authz, input validation, CSRF, secrets, logging of PII
- [~] **Performance** review (`performance-reviewer` agent): both High findings fixed and owner pages
  in the budget. Left open: owner messages sent again on every step, versioning the Mapbox worker
  file, a `Buffer.from` copy in the media route, and the query count of an autosave
- [~] **Accessibility** (`accessibility-reviewer` agent): axe clean in both languages, keyboard path
  and focus tested. Left open: the manual screen reader checks below
- [~] **i18n** (`i18n-reviewer` agent): catalogs complete in both languages. Left open: the
  native-speaker list below
- [x] **Contracts & docs**: OpenAPI/client regenerated, migrations reviewed, memory.md updated if something non-obvious was learned

- [~] Owner profiles + verification states: individuals and businesses from day one, with the
  tax details DAC7 reporting needs (exact fields after #18). `verified` and `rejected` are set by
  hand until Phase 5
- [~] Proof of the right to rent: private upload, kept apart from public photos, EXIF removed from
  scans. Tested on local files; S3 only against a mocked client
- [~] Facilities (`parking_locations`, PostGIS point, IANA time zone) and spaces: owners create and
  edit them. The location step's map is unverified
- [x] Named units (decision: named spaces, no pooled inventory)
- [~] Photos (S3), listing status, amenities: all work on local files; S3 only against a mocked client
- [~] Schedules and availability exceptions (DST-safe in Europe/Athens): weekly hours done, owners
  set them; exceptions (holidays, closures) missing
- [x] Pricing rules + server-side quotes (integer minor units): weekend, day and night, long-stay,
      per-space and dated prices (memory.md #17), and search showing "from" the cheapest free space
- [x] Owner setting: gap between bookings on a space (none, 30 or 60 minutes). Saved here; Phase 3
      applies it
- [x] Exit criteria: an owner manages their facility without reaching another owner's data (smoke + integration test)

**Try with the real thing** (none of these has run yet):

- [ ] The map, with a Mapbox token: the pin, dragging it, address search, and no CSP violations
- [ ] Uploads against a real S3 bucket
- [ ] A status email and a reminder through Resend

**Manual NVDA and VoiceOver checks** (from the accessibility review):

- [ ] Is an error read on arrival when `setErrors` and `.focus()` run in the same tick?
      (`location-form.tsx`, `spaces-form.tsx`, `prices-form.tsx`, `submit-listing.tsx`) If not, focus in an effect
- [ ] Does focus moving to the file input cut off "Photo removed"? (`photos-step.tsx`, `proof-step.tsx`)
- [ ] Does the delete question read well?
- [ ] How do both screen readers read the radio group's error?
- [ ] How does `role="application"` behave, and do the Mapbox strings work with a Greek voice?
- [ ] Is the pace of `SaveStatus` tolerable?
- [ ] In a real Windows contrast theme, is the selected radio's dot visible? (`radio-group.tsx`)

**Native-speaker pass** (from the i18n review; the Greek so far is a non-native judgement):

- [ ] `Home.ownerHeading`, `ownerText`, `ownerAction`, `Header.listParking`
- [ ] New `Listing` keys: `perHourFrom`, `totalPriceFrom`, `totalLabelFrom`, `photosHeading`,
      `photoAlt`, `spacePrice`, `spaceTotal`, `weekendRate`, `nightRate`, `datedRate`, `longStay`,
      `cancellationHeading`, `cancellation.*`
- [ ] `Validation.textTooLong` through `landRegistrationInvalid` (39 keys), and one verb throughout:
      Εισαγάγετε or Συμπληρώστε
- [ ] `Owner.metaTitle`, `Owner.optional`, `Owner.landing.*`, `Owner.state.*`, `Owner.save.*`,
      `Owner.step.*`, `Owner.stepNames.*`, `Owner.stepLeads.*`, `Owner.errors.*`
- [ ] `Owner.dashboard.*`, including `checks.payouts`: "Πληρωμές" is also the word for drivers' payments
- [ ] `Owner.profile.*`, `Owner.location.*`, `Owner.spaces.*`, `Owner.photos.*`
- [ ] `Owner.hours.*`, especially `overnightHint`
- [ ] `Owner.prices.*`: "Μέτρια" can read as "mediocre"; "Ενδιάμεση" is a candidate
- [ ] `Owner.tax.*`, with the accountant for "Αριθμός ΦΠΑ", ΑΦΜ and ΓΕΜΗ
- [ ] `Owner.proof.*`, with the lawyer for Συμβόλαιο ιδιοκτησίας, υπεκμίσθωση, ΚΑΕΚ, and the
      wording for renting out (ενοικιάζω)
- [ ] `Owner.review.*`, especially the legal `confirm` sentence
- [ ] The `el` block of `packages/email/src/owner-emails.ts`: footer, `linkFallback` and all four
      email kinds
- [ ] The Mapbox strings

## Phase 3: Search and booking engine

- [~] Geospatial search + listing pages: done with curated areas + browser location (1.11);
  map (Mapbox, CSP updated deliberately) and address search missing
- [~] Availability + quote endpoints: opening hours + quote done; free spaces ignore bookings
  until booking exists
- [ ] Transactional allocation + holds (exclusion constraints, `[start, end)`): the driver picks
      the space from a list, 10-minute hold, the owner's gap counts as overlap, a "just taken"
      state, and the listing's 48-space cap (1.12) must not hide free spaces
- [ ] Booking requires a signed-in account (no guest checkout)
- [ ] Hold expiry worker, cancellations, booking history
- [ ] Concurrency tests (named spot race, last pooled unit) and DST edge cases
- [ ] Transactional outbox

## Phase 4: Payments and payouts

- [ ] Accountant and lawyer confirm the Greek/EU rules before this phase starts (#18)
- [ ] Confirm Stripe Connect eligibility and how long funds may be held (#19); funds flow decided:
      separate charges and transfers
- [ ] Connected-account onboarding
- [ ] Checkout (charge in full at booking), signed webhooks, idempotency, payment state machine
- [ ] Refunds, fees, transfers, ledger, reconciliation: commission from the owner's share (10%,
      a stored setting that is easy to change, kept on each booking), each owner's choice of the
      three cancellation policies (memory.md #16), payout 24 hours after the stay ends
- [ ] Late-payment and dispute workflows: a payment after the hold keeps the booking if the
      space is still free, otherwise a full refund

## Phase 5: Owner and admin dashboards

- [~] 2FA enrolment UI done (1.3); admin MFA enforced end to end once admin routes exist
  (sessions without a second factor are already ended when it is switched on)
- [ ] Owner calendar, bookings, listings, earnings
- [ ] Admin approvals (listings, proof of the right to rent), moderation, users, bookings,
      payments, audit logs
- [ ] Overstay reports: the owner reports, support handles it (#11)
- [ ] Support removes two-factor after an identity check: audited action, email to the address,
      written procedure (#13)

## Phase 6: Production readiness

- [ ] Security + privacy review, GDPR retention and data-subject workflows (unconfirmed
      accounts are handled, 1.14; the adviser sets the periods, #18). Owner onboarding adds:
      Mapbox as a processor of owners' IP addresses, how long `email_outbox` keeps sent rows
      (90 days today), and deleting an owner's account along with their tax values and proofs
- [ ] Owner onboarding in production: `OWNER_DATA_KEY`, `S3_BUCKET` and a role with
      `s3:ListBucket` (without it a missing photo is a 500 rather than a 404), `MAPBOX_PUBLIC_TOKEN`
      and a card on the account for permanent geocoding, `UV_THREADPOOL_SIZE=16`, a CDN in front of
      media, and a repeat of the upload burst in the production image with a memory limit and
      `MALLOC_ARENA_MAX` set
- [ ] Cookie notice/inventory: Better Auth session cookies, `NEXT_LOCALE` (session),
      `theme` (display preference, first-party, 1 year, `light`/`dark`)
- [ ] Backups, restore drill, monitoring, alerts, runbooks
- [ ] Load tests for search and booking
- [ ] Payment failure/refund/dispute/reconciliation tests
- [ ] Staged pilot
