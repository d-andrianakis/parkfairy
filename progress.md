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
- [x] At scale: opening-hours filter in SQL (2026-11-07). A candidate's weekly hours, as a
      minute-of-week multirange, must cover the stay before it takes a batch's place; listings with
      closures or special hours that day are left to `isOpenThroughout`. Tested with 500 shut
      listings ahead of an open one (`parking.integration.test.ts`)
- [ ] At scale: short-TTL search caching (perf review finding 6, deferred until real inventory)
- [ ] At scale, deferred until measured on about 10,000 listings (perf review 2026-11-07): the
      weekly hours read per candidate (a covering index on `parking_opening_hours`, or the week
      stored as a multirange on the listing, written with the hours); one probe of the closures
      index per candidate, not two; special hours and closed parts in SQL too, so a holiday copied
      across a chain doesn't fill the batches; keyset batches instead of OFFSET. The stay's minutes
      of the week are already worked out once per time zone (`weekNeeded`), not per row
- [ ] Known: a stay inside the hour the clocks repeat (03:30 summer time to 03:00 winter time) is
      taken as open whatever the hours: `isOpenThroughout` finds no wall-clock minutes to check.
      Half an hour a year; search no longer fails on it (2026-11-07)
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
- [x] Opening-hours check in SQL (done 2026-11-07, see 1.11)
- [ ] Deferred: top-48 spaces in SQL (needs an ICU numeric collation; worth it above about 10,000
      spaces in one listing)
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
- [x] Minor: while a two-factor step's code loads, `fallback={null}` showed nothing and the button
      was already gone (`two-factor-settings.tsx`). Fixed 2026-11-07: the step opens in a
      transition inside a boundary that is always there, so the overview stays, its button busy
      and focused, until the step arrives (`two-factor-settings.load.test.tsx`). A spinner shows
      after 300 ms, so code that is already loaded doesn't flash it
- [ ] Known (accessibility review 2026-11-07): if the steps' code fails to load (offline), the
      error page replaces the whole account page, and `lazy` keeps the failure until a reload.
      DateTimeField's fallback to native fields is the gentler model
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
- [x] Spring-forward night: a From of 03:00 or 03:30 with a stay of an hour or less is refused
      with the usual error (memory.md). Decided 2026-11-04: they stay on offer (#32)
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
- [x] **Performance** review (`performance-reviewer` agent): both High findings fixed and owner pages
      in the budget. The four left open were done on 2026-11-07: owner messages come from one owner
      layout, so moving between steps doesn't send them again (`performance.smoke.ts`); the Mapbox
      worker's name carries its version and only that file is cached for a year (a 404 for a name
      not shipped yet isn't); S3 reads no longer copy the file (`object-store.test.ts`); a save
      answers with its progress in one statement instead of five at once, checked against what the
      listing reads back. Signed out, `/owner` carries no owner messages. Re-reviewed by all five
      agents on 2026-11-07; their findings fixed or listed in 1.11, 1.15 and here
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
- [x] Schedules and availability exceptions (DST-safe in Europe/Athens): weekly hours, with a break
      if wanted, and closures and special hours (2.2)
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

### 2.2 Closures and special hours (2026-11-03)

Dates when a listing keeps other hours than its week: closed all day, open other hours, or closed
for part of the day. Also a break inside the weekly hours, and copying one listing's dates to the
owner's others. Decisions #24–#29 in memory.md: owners change them at any status without review,
drivers see dates and hours but never the note, and Phase 3 refuses closing time over bookings.

- [x] **Implemented** behind the API's authorization rules: `/owner/listings/:id/closures` (any
      status, no review), `PUT …/hours-exceptions`, `POST …/hours-exceptions/copy` (one
      transaction, 10 a minute), the break on the hours step, search and the listing page honouring
      all three kinds (full-day closures filtered in search's SQL), dates and hours on the listing
      page without the note, migrations 0011–0013, and a sweep of ended entries every 6 hours
- [x] **Unit tests**: contracts, `opening-hours.test.ts` (both clock changes), `owner-hours.test.ts`,
      the form, copy and public-table components, owner pages, dashboard, the worker job.
      Integration (`owner.integration.test.ts`, "closures and special hours"): strangers, every
      status, search and listing page, copy outcomes and limit, races, the sweep on the Athens
      calendar, each database constraint by name
- [x] **Smoke test** `owner-closures.smoke.ts`: dashboard to a live listing, all three kinds, an
      overlap, a save with Enter, copying, the weekly break, Greek at 320 px, search, the listing
      page in both languages, strangers. Also the page in `accessibility.smoke.ts` (keyboard, dark,
      no database needed), cross-site writes in `security.smoke.ts`, and the JS budget
- [x] **Security** review: nothing critical or high. Fixed: copy's own limit and cost, a floor on the
      first day (year 0 was a 500), ended notes swept, copy's partial failure and midnight race (one
      transaction now). Accepted: the dates of a private owner's closures are public (#26; Phase 6)
- [x] **Performance** review: nothing high. Fixed: copying in about 7 statements, full-day closures
      filtered in search's SQL (holidays filled the candidate batches), live listings' rows no
      longer rewritten, two date formatters per page. Left open below
- [x] **Accessibility** review: fixed focus lost after a save with Enter (serious), specific date
      messages, the first error as the page reads, visible period headings, the overlap naming its
      period, copy errors on the checkbox and repeated, `lang` on names inside sentences, hints for
      the date range and the limit, break errors on the right time, the table named by its heading
      with `<time>`, a page title naming the listing. Manual checks below
- [x] **i18n** review: copy wording (it misstated the clash rule), "from" in a closed part, "Period"
      for an entry, the limit stated, Greek wording. `catalogs.test.ts` now checks rich-text tags.
      Native-speaker list below
- [x] **Contracts & docs**: OpenAPI and client regenerated, migrations 0011–0013 reviewed (a new
      table, then nullable columns), memory.md

Left open:

- [x] Performance (2026-11-07): the closures page reads only its listing's name and entries
      (`GET /owner/listings/:id/hours-exceptions`), and it and the hours step ask for the owner's
      other listings alone (`GET /owner/listings/:id/others`), not the dashboard's overview; the
      demo seed gives Πάρκινγκ Ερμού dated closures, so the search latency budget meets them
- [ ] Performance, deferred as low: a search batch fans out 6 queries against a pool of 10; every
      row re-renders on each keystroke (not measured at 30 rows)
- [ ] Known: a week open all day with a daily break reads back as "17:00 to 14:00" each night. The
      same hours, saved again unchanged, but not as entered (memory.md)
- [ ] Manual NVDA and VoiceOver: removing a period (the announcement, then the focus on Add), an
      invalid save (the count and the field's error), copying with nothing ticked, the radio group
      inside the named period, date fields (segments, min and max; the browser orders the date its
      own way), the Greek public table, Greek listing names in English copy results
- [ ] Native speaker: `Owner.closures.*`, `Owner.hours.closedPart*`, `closedFrom*`, `closedTo*`,
      `closedPartInvalid`, `Owner.dashboard.closures`, `Listing.exceptionsHeading`,
      `Listing.closedBetween`, `Validation.dateInPast`, `dateTooFar`, `exceptionOverlap`,
      `closedTimeOrder`, `dateRequired`, `lastDayBeforeFirst`. Questions: does "Κλειστά από:
      Δευτέρα" heard alone suggest "from Monday on"; `copyDone` "σε 1 χώρο" or "σε έναν χώρο";
      "για «{name}»" or "για τον χώρο «{name}»"

### 2.3 Weekly hours copied to other listings (2026-11-04)

The hours step offers its week to the owner's drafts and listings sent back, replacing theirs
(decision #30). Changes not yet saved are saved first, since saving the step otherwise moves on.

- [x] **Implemented** behind the API's authorization rules: `POST …/hours/copy` (one transaction,
      targets locked in id order, 10 a minute, `locked` for a listing with staff, live or
      suspended, `NOTHING_TO_COPY` for an empty week); the closures copy section became
      `CopyToListings`, shared by both
- [x] **Unit tests**: contracts; `copy-weekly-hours.test.tsx` through the real hours form (saved
      first, refused saves and copies, the busy label, focus, Greek, unnamed drafts); the hours
      form's own save paths; owner pages (who is offered, the closures sentence outside the offer).
      Integration: every status, route validation, `updated_at`, races with a save and with a
      submission (both fail without the row lock), opposite orders without a deadlock
- [x] **Smoke test**: `owner-closures.smoke.ts` copies a week with a break to a third draft, saved
      first, the live listing not offered, then the offer in Greek at 320 px; strangers' and
      cross-site copies refused (`security.smoke.ts`)
- [x] **Security** review: nothing above low. Fixed: one listing named in two cases counted twice
      (one 404 for the owner's own); `copyHours` added to the Phase 3 list. Each copy route counts its
      own ten a minute (memory.md)
- [x] **Performance** review: nothing above low; worst case 50 targets locked for about 30 ms. Fixed:
      the source week read before the lock. Accepted: the hours step's second API read (as on the
      closures page), owner messages growing
- [x] **Accessibility** review: fixed the "choose a listing" error arriving after the focus (also on
      the closures page), a failed save now said in the copy section, "saved and copied", "Saving…"
      while it saves, numbered unnamed drafts, the closures sentence before the offer, the step list
      refreshed after saving, long names wrapping at 320 px
- [x] **i18n** review: "these weekly hours" (it read as this calendar week), status lines with their
      subject in both copies, a clearer empty-week message, Greek wording
- [x] **Contracts & docs**: OpenAPI and client regenerated, no migration, memory.md

Left open:

- [ ] Native speaker: `Owner.hours.copy*`, `Owner.errors.NOTHING_TO_COPY`,
      `Owner.dashboard.untitledNumber`, `Owner.closures.copyDone`. Questions: "παίρνει" or
      "αντικαθιστά"; "σας επιστρέψαμε για αλλαγές" beside the badge "Χρειάζεται αλλαγή"; "κρατά το
      δικό του"; "σε 1 χώρο" or "σε έναν χώρο"
- [ ] Manual NVDA and VoiceOver: copying with nothing ticked, save-then-copy (whether the "Saving…"
      and "Copying…" button names cut off the report), a failed save from Copy (the form's alert and
      the section's line together), Greek names in English status lines and the reverse

## Phase 3: Search and booking engine

- [~] Geospatial search + listing pages: curated areas + browser location (1.11), address search
  with suggestions and a results map on request (3.2). Built and tested with Mapbox mocked: the first
  run with a real token is still to come (#42)
- [x] Availability + quote endpoints: free spaces subtract bookings and running holds, the owner's
      gap included, in search and on the listing page; "from" is the cheapest free space (3.1)
- [x] Transactional allocation + holds (exclusion constraint on `[starts_at, blocked_until)`): the
      driver picks the space from a list, a 10-minute hold, the gap counts as overlap, "just taken",
      and with a stay the listing sends only free spaces, so the 48 cap hides none (3.1)
- [x] Closing time over a booking is refused until the owner cancels it (#27): `saveHoursExceptions`
      and `saveHours` refuse (`LISTING_BOOKED`), both copies report `booked`, removing a booked
      space is refused (`SPACES_BOOKED`); the hours in effect are checked, and holds and
      confirmations take `FOR SHARE` on the listing (3.1). Entries still get new ids on every save:
      diff instead if a booking must ever point at the closure that cancelled it
- [x] Booking requires a signed-in account (no guest checkout)
- [x] Hold expiry worker, cancellations, booking history (3.1)
- [x] Concurrency tests (one space, one hold per driver, a closure against a confirmation) and DST
      edge cases. "Last pooled unit" doesn't apply: spaces are named (#1)
- [x] Transactional outbox: booking emails are written in the booking's own transaction (3.1)

### 3.1 Booking (2026-11-08)

A driver picks a free space for a stay, holds it for ten minutes, gives the car's plate and
confirms; until payments exist that confirms without one, on a local run only (#33). Their bookings
are listed, and one can be cancelled by its policy until arrival. The owner sees each listing's
bookings, who is coming in which car (#35), and cancels one with a full refund; closing time over a
booking waits for that (#27). Four emails through the outbox (#36). Decisions #33–#36 and the
readings taken without asking are in memory.md.

- [x] **Implemented** behind the API's authorization rules: `POST /bookings` (hold), `GET /bookings`
      and `/bookings/:id`, `POST /bookings/:id/confirm` and `/cancel`, `GET` and `POST …/cancel` of
      `/owner/listings/:id/bookings`, `POST /bookings/:id/extend`; migrations 0014–0018 (table,
      exclusion constraint, one hold per driver, the listing-wide index, extensions counted); the guard in the owner's hours, closures, copies and
      spaces; the worker's expiry sweep (every minute) and stale-hold deletion (hourly, after 7 days);
      the listing page's picker, the booking page, the bookings list, the owner's bookings page;
      names checked when changed; `no-store` on every answer that needs a session
- [x] **Unit tests**: contracts (plates, inputs, lists), refunds, references, the service's refusals,
      env, the interceptor, auth's name check, worker jobs, both email kinds in both languages, and
      the web's picker, confirm, cancel, owner cancel, pages, loaders, links and refusals.
      Integration (`bookings.integration.test.ts`, 48 tests): authorization, holds, the gap, races
      (pairs on one space, one driver's two presses, a closure against a confirmation; the last
      fails without the listing lock), lapsed holds booking nothing, keeping a hold and its limit, refunds
      and `REFUND_CHANGED`, lists, paging, the owner's page, the guard on every route, the 48 cap,
      the cheapest free space, both clock changes
- [x] **Smoke test** `booking.smoke.ts`: signed out to signed in on the same stay, hold, plate,
      confirm, both sides' emails, the list, the owner's page, a closure refused then saved after the
      owner cancels, the driver told; a space taken meanwhile; a cancel by the terms; Greek at
      320 px. Also the booking pages in `accessibility.smoke.ts`, cross-site writes in
      `security.smoke.ts`, budgets in `performance.smoke.ts`
- [x] **Security** review: no IDOR, nothing above medium. Fixed: one hold per driver under
      concurrency (M1), account names unchecked after sign-up now reaching owners (M2), late
      confirmations without limit (L1: none at all since #37), a refund lower than shown (L4), `no-store` (L5), stale holds
      (L7, in part). Open below
- [x] **Performance** review: fixed both highs (the per-space probe repeated per aggregate, the
      guard reading whole histories under locks) and the mediums (full garages in search, the picker
      on every listing view, the stale-hold sweep, the owner list's history scan). Open below
- [x] **Accessibility** review: nothing serious. The static hold time was judged enough for 2.2.1
      while a late confirmation worked; since #37 ends that, the hold can be kept for 10 more
      minutes up to ten times, with a warning two minutes before. Fixed: focus and the alert when the last
      space goes, features read as "Features", the plate typed twice (3.3.7), the owner's cancel
      announcement, a silent change of space, "below", the doubled group, the notice before the h1,
      `lang` in the hold sentence, the zone of the hold's time, the hint on Book, focus rings, link
      names in the list, a way back to closures. Manual checks below
- [x] **i18n** review: fixed "out of 1", "and 3 more" counting booked spaces, "€0.00 comes back",
      the closing message on the spaces step, παραμονή for στάθμευση, and the minors (wording, Greek
      agreement, Latin plate examples in English, `lang` in emails, the email's gender). Native
      speaker below
- [x] **Contracts & docs**: OpenAPI and client regenerated, migrations 0014–0018 reviewed,
      GETTING_STARTED.md (booking on this machine), memory.md

Left open:

- [x] Security L2, L3, L6: done in 3.3 (limits per account, the owner's email cap, the listing
      kept on each booking)
- [ ] Security, for Phase 4: Stripe Radar or review against self-dealing (`OWN_LISTING` stops only
      the same account)
- [x] Performance, deferred as low: keyset pages for the owner list, the email sender's pace and the
      hold's 11 round trips: done in 3.4
- [ ] Performance, for later migrations: future indexes on a full `bookings` built `CONCURRENTLY`
      (outside the migration runner, which wraps each file in a transaction), and new email kinds
      added `NOT VALID` then validated
- [x] Tests still missing: done in 3.3 (a stay under way with a fixed `now`, two confirmations at
      once with different plates, the reference collision and its giving up)
- [x] The sign-in page's link to sign up drops `?next=`: fixed in 3.3, both ways and through the
      "check your inbox" panel. The emailed link still can't carry it (links in emails are rebuilt)
- [x] Accessibility advisories: done in 3.3 ("Let this space go" asks first and the listing says
      it went; `booked` lines link to that listing's bookings; the closures page keeps its unsaved
      rows while the owner cancels bookings)
- [ ] Manual NVDA and VoiceOver: the hold's warning (read once, two minutes before, without
      moving the focus) and "Kept for you until"; the ended heading taking the focus when the form
      goes; the last space taken (focus, the alert once); radios with features
      read with them; the owner's cancel notice; the confirm and cancel notices read once, and
      reading on reaches the h1; the cancel question in full; a link inside an alert; Greek labels
      inside an English hold sentence; `aria-current` on the bookings tabs; the Greek booking page
      at 200% text
- [ ] Native speaker: `Header.bookings`; `Listing.chooseSpaceHeading`, `freeOfTotal`,
      `moreFreeSpaces`, `signInToBook`, `accountToBook`, `bookBelow`; `Validation.plateRequired`,
      `plateInvalid`; `BookSpace.*`, `BookingErrors.*`, `Booking.*`, `Bookings.*`,
      `Owner.bookings.*`, `Owner.dashboard.bookings`, `Owner.errors.LISTING_BOOKED`, `SPACES_BOOKED`,
      `BOOKING_STARTED`, `BOOKING_NOT_FOUND`, `Owner.hours.copyBooked`, `Owner.closures.copyBooked`
      (`Booking.keep`, `holdWarning`, `holdLimit`, `heldEnded*` especially, and the «·» in `heldUntil`),
      and the `el` block of `packages/email/src/booking-emails.ts`. Questions: στάθμευση or
      παραμονή; «ιδιοκτήτης» for a host who may rent the space or be a business; Επερχόμενες or
      Προσεχείς, Παλαιότερες or Προηγούμενες; Κωδικός or Αριθμός κράτησης; «έως τις 01:05» or
      «έως τη 01:05»; «Κρατημένη για εσάς» as a badge; Εισαγάγετε or Συμπληρώστε, now for the plate

### 3.2 Address search and the results map (2026-11-09)

Drivers type an address and pick from suggestions (Mapbox Search Box through our API, #40); text
not picked is looked up by the server, once, and the page goes on to its position. Results can show
a map on request, its pins numbered as the list (#41). No token on this machine yet, so Mapbox is
mocked (#42): the address field and the map show only where `MAPBOX_PUBLIC_TOKEN` is set.

- [x] **Implemented** behind the API's authorization rules: `GET /v1/places/suggestions`,
      `/places/retrieve`, `/places` (public, `no-store`, per-route limits, 100 an hour per visitor
      across the three, cross-site requests refused, the site's hourly budget in billed units, a
      breaker when Mapbox keeps failing); search results carry each listing's position; the search
      page's look-up and redirect (`place`, `placeLocale`), only for searches made here; the address
      combobox (`AddressField`, its list loaded on focus); "Show the map" (`ResultsMapToggle`, the map
      loaded on a press and kept once shown); Mapbox in the CSP of the search page only; links into
      search load a real page where there can be a map (`SearchLink`)
- [x] **Unit tests**: contracts (queries, place ids, labels), the Mapbox client (parameters, shapes,
      refusals, the token kept out of messages), the budget (sessions once, per hour, Redis failing),
      the visitor guard, the service (no token, budget, breaker), env, log redaction; web: the
      combobox (keys, pointer, stale answers, blur into the list, positions and language, area and
      place clearing each other, failures, Greek, axe), the list, the map (pins as named links with
      `lang`, Mapbox's defaults removed, token and worker, out-of-view pins, axe), the toggle (one map
      per page, the status line), the search page (look-up and redirect, not found, unavailable,
      cross-site, no token, the heading's language, pins, `<ol>`, Greek, axe), `parseSearch`,
      `lookupPlace`, the search form, near me, `SearchLink`, `allowsMaps`, the card's number.
      Integration (`places.integration.test.ts`): anonymous use, Mapbox as its docs describe it,
      validation before any call, the visitor limit, `no-store`, cross-site refused, no token
- [~] **Smoke test** (`parking.smoke.ts`): a place with its position searched and named (English,
  and Greek marked as English after a switch), no address field or map without a token, a place
  alone then asking for an area, the API unavailable without a token; the CSP in
  `owner-onboarding.smoke.ts`. The path with a token (suggestions, a pick, the map's pins) is
  written and skips until a token exists (#42)
- [x] **Security** review: nothing above medium. Fixed: one client could spend the site's budget, and
      other sites' pages could spend it from visitors' browsers (M1); typed addresses reached the
      request log (M2); the public token standing in for the server's in production (L3); `.`/`..`
      parts in place ids (L4); the budget failing open with Redis (L5). Accepted: any text can head the
      results as the place's name (escaped, as any search page echoes its query). Open below
- [x] **Performance** review: nothing high, every page under budget. Fixed: the budget counted calls,
      not what Mapbox bills (M1); the owner-email count reading a driver's whole history under the
      locks; full page loads into search with no map to allow; the map library fetched only after the
      press, and a new map at every show; the API client on every home and search visit; no breaker.
      Recorded: how to run 0019's kind of backfill on a large table (memory.md)
- [x] **Accessibility** review: fixed Mapbox turning every pin into an image named "Map marker"; the
      current suggestion shown by a 1.1:1 fill only; a tap on the list's edge closing it before the
      pick; the list read last on phones (portal at the end of `<body>`); the map's focus rings;
      nested regions with one name; the logo link named by its picture; the active option scrolled
      out of view; numbered pins over an unordered list; the loading line not read; "My location"
      left after typing. Then, by decision #45: "Show all results" and cooperative gestures on the
      map. The advisory (`lang` on Greek-script names Mapbox returns in English, and on its English
      attribution in Greek) is done in 3.4
- [x] **i18n** review: fixed the Greek heading («κοντά στο σημείο»), the pin's total without "from",
      the place's language after a switch, the address label read as "either… or", the error summary's
      and the list's names, the wording of `pickFailed`, `placeTooShort` (characters),
      `placeNotFound`, the map's control names, the "keep" buttons. Native speaker below
- [x] **Contracts & docs**: OpenAPI and client regenerated, `.env.example` (`MAPBOX_SEARCH_TOKEN`,
      `MAPBOX_SEARCH_HOURLY_LIMIT`), memory.md

Left open:

- [ ] The first run with a Mapbox token: the token-gated smoke test, the map and the combobox in real
      browsers, and the numbers the budget and limits were set to (#42)
- [ ] Manual NVDA, JAWS, VoiceOver (macOS, iOS) and TalkBack: the count and "Chosen: …" read once
      without cutting off typing; options read "name, detail"; Enter picks; the problem line read
      once; `aria-activedescendant` into the list; a tap on an option (and on the list's edge) picks;
      swiping from the field reaches the list next; pins in the links list, the canvas's name, the tab
      order (pins, then controls), focus on pins and zoom buttons in Windows contrast themes and the
      dark theme
- [ ] Native speaker: `SearchForm.address*`, `suggestion*`, `placeChosen`, `pickFailed`,
      `noSuggestions`, `suggestionsUnavailable`; `Search.titlePlace`, `lookupPending`, `showMap`,
      `hideMap`; `ResultsMap.*`; `Validation.place*`. Questions: σημείο or τοποθεσία for "place";
      «Ο χάρτης δεν φόρτωσε»; «Χάρτης των αποτελεσμάτων» or «Χάρτης αποτελεσμάτων»; «κάτω από το πεδίο»

### 3.3 Booking follow-ups (2026-11-09)

The 3.1 leftovers chosen in #43: sign-up keeps `?next=`, the missing tests, the accessibility
advisories, per-account hold limits (L2), the owner's email cap (L3), the listing's name and address
kept on each booking (L6).

- [x] **Implemented** behind the API's authorization rules: `AccountThrottlerGuard` on hold, confirm
      and extend; `ownerStillHears` (six emails a day from one driver's doings at one owner's
      listings); migration 0019 and the snapshot read by the driver's pages and every email; the
      sign-in and sign-up links and the sent panel keeping `next`; "Let this space go" asking first
      and the listing's notice; the copy report's links to bookings; the closures draft
- [x] **Unit tests**: the account guard, env; web: the release question (every "No" gives the focus
      back, none while letting go, a failure keeps it), the released notice, the copy report's link,
      the closures draft (kept, restored once, the message gone after a save, storage blocked,
      expiry), the auth pages' links, the sent panel. Integration (`bookings.integration.test.ts`,
      follow-ups): the snapshot through an edit, the confirmation and an owner's cancel; the email
      cap, its day and its scope (owner cancels don't count, all of one owner's listings); limits per
      account on hold, confirm and extend; two confirmations at once with different plates; a taken
      reference and giving up after three; a stay under way checked from a fixed `now`
- [x] **Smoke test**: `booking.smoke.ts` (the closures entry back after the owner cancels the booking,
      the release question and the listing's notice in Greek at 320 px), `auth.smoke.ts` (`next` both
      ways)
- [x] **Security** review: nothing on these above low; noted that a driver can use up the cap with
      three book-and-cancel loops before a real booking (it still shows on the owner's page; #43)
- [x] **Performance** review: fixed the cap's query (bounded to the day); 0019 recorded above
- [x] **Accessibility** review: fixed "No, keep it" losing the focus on a second press and answering
      while the space was being let go, and the restored-entries message outliving the save
- [x] **i18n** review: «Όχι, να μείνει κρατημένη» for the release's "keep"
- [x] **Contracts & docs**: migration 0019 reviewed, memory.md

Left open:

- [ ] Manual NVDA and VoiceOver: the release question read in full with the Greek space label; the
      released notice on `/el` read with the Greek voice; the restored-entries message read after
      `RouteFocus` moves the focus
- [ ] Native speaker: `Booking.releaseQuestion`, `releaseConfirm`, `releaseKeep`,
      `Listing.releasedTitle`, `releasedLead`, `Owner.closures.draftRestored` (Questions: «επανήλθαν»;
      «να μείνει κρατημένη»)

### 3.4 Phase 3 follow-ups (2026-11-10)

The leftovers of 3.1 and 3.2 that need nobody outside the project: keyset pages for the owner's
bookings, the hold's round trips, the email sender's pace, and `lang` on Greek words inside English
text (the 3.2 advisory). No product decisions were needed; what the reviews changed is below.

- [x] **Implemented** behind the API's authorization rules:
  - The owner's bookings page by place, not page number: `?after=`/`?before=` cursors (a booking's
    start and id), `previous`/`next` in the answer, a probe for the side we came from, a place with
    nothing left going to the first page (the cancel notice kept), and a cancel coming back to its
    page. Cursors past 9999 are refused.
  - The hold in 6 round trips instead of 11, and the confirmation in 8: the space read with the
    listing, hours, closures and prices in one statement (`listingRulesIn`), and the driver's holds
    let go with other drivers' lapsed holds expired in one statement (`clearForHold`).
  - The worker's sender drains a backlog while claims come back full. Each claim holds only what its
    pace (`EMAIL_SENDS_PER_SECOND`, default 1) sends in the 25 s it has, and a claim whose sends all
    fail ends the run. The web app's account emails go at one a second too, so the two together stay
    within Resend's 2.
  - Migration 0020: `bookings_location_starts_idx` replaced by `(location_id, starts_at, id)`, so a
    place is an exact index condition and pages come in index order (chosen in the decisions form,
    while it is still a plain migration).
  - Greek-script runs marked `lang="el"` inside English text (`greekRuns`, `PlaceWords`) in these
    places:
    - Mapbox's suggestions and the search heading;
    - the owner's address matches, now asked for in the listing's language;
    - listing names and addresses on the card, the listing page, booking facts, the review summary,
      the owner's pages and the map's pins;
    - the address field after a language switch.

    Mapbox's attribution is marked English on both maps.

  - A second notice on the same page (owner cancels, `?done=`) is keyed, so it is read and focused.
- [x] **Unit tests**:
  - Contracts: cursors, both ways, past 9999.
  - Worker: claims sized to the pace (1, 4 and 0.5 a second), failures across claims, a whole claim
    failing.
  - Env and transport: the pace, `intervalMs`.
  - `greekRuns`: glued digits, the numeral sign, several runs, polytonic and decomposed accents.
  - Web:
    - the owner's page: cursors, refusals, both redirects in both languages, a cancel coming back to
      its place, a second cancel focused, axe on a paged render;
    - the booking page's second notice;
    - the loader;
    - the suggestion list, the search heading and the address field's `lang`;
    - the card, the pins, the owner's matches in the listing's language, the attribution on both
      maps.
  - Integration (`bookings.integration.test.ts`, 63 tests):
    - 45 bookings paged both ways, with ties on the start broken by id;
    - cancels on an earlier page, including the booking the place is;
    - an emptied page, refused cursors, an old `?page=`;
    - `listingRulesIn` equal to the three separate reads, at the edges of its days and out of
      insertion order, and a hold priced by a dated rate as the listing page quotes it;
    - an inactive space at the hold, a removed space at the confirmation, a driver holding again
      after an unswept lapse.
- [x] **Smoke test**:
  - `booking.smoke.ts`: an owner with 25 bookings pages Next and Previous, cancels on page two and
    comes back to it with the notice focused, then a place with nothing after it in Greek lands on
    the first page. The first test's emptied place keeps `?cancelled=` and focuses the notice.
  - `parking.smoke.ts`: a Greek name in an English heading, with axe, and the attribution in the
    token-gated test.
- [x] **Security** review: nothing above low. Fixed: a cursor past year 9999 answering 500
      (Postgres can't read `+010000-…`)
- [x] **Performance** review: hold and confirmation confirmed at 6 and 8 round trips,
      `listingRulesIn` 34 buffers. Fixed, measured on 1.68M bookings:
  - the unordered probe, which scanned the whole table past ~1% of it;
  - the hand-added start bound, which made deep pages read and sort every booking left;
  - the web app's pace, which made the "half each" split hold.

  Open below.

- [x] **Accessibility** review. Fixed:
  - a second cancel's notice, which was neither read nor focused (Next keeps the page when only the
    query changes), and the same with `?done=`;
  - Greek in stored names and addresses;
  - ordinals split from their letters;
  - the field's `lang` after a switch;
  - axe on the new states.

  Manual checks below.

- [x] **i18n** review. Fixed:
  - the owner's address search, which asked Mapbox in the page's language but saved the answer as
    the listing's;
  - stored text;
  - run boundaries («28ης Οκτωβρίου», «Α1», «Γʹ»);
  - Greek tests for the redirect and the pager.

  No new strings.

- [x] **Contracts & docs**: OpenAPI and client regenerated, migration 0020 reviewed, `.env.example`
      (`EMAIL_SENDS_PER_SECOND`), memory.md

Left open:

- [ ] Performance, low:
  - A covering partial index for page 1 of a very busy garage, which walks the last 31 days. Wait
    until one exists.
  - A deadline per email in the sender, handing back unsent claims: a slow Resend can stretch a
    run past 30 s.
  - `setGlobalConcurrency(1)` on the email queue once there are several worker replicas.
  - A stop timeout above 30 s on the platform, or a closing flag checked before each claim.
- [ ] Booking emails mark the address with the listing's language only: Greek words in an English
      listing's address aren't marked in their HTML (`greekRuns` is the web app's)
- [ ] Names inside translated sentences (`t.rich` chunks: milestones, the booking page's notices)
      carry the listing's `lang` but no marking per run
- [ ] Manual NVDA (Chrome, Firefox, a Greek voice installed), JAWS, VoiceOver (macOS, iOS) and
      TalkBack:
  - the English search heading switching voice for the Greek words only;
  - an option with a Greek name (voice, and "name, detail");
  - the owner's matches in a Greek and an English listing;
  - the attribution read in English on `/el`;
  - whether any reader honours `lang` inside the "Chosen: …" live region, which decides whether it
    should carry it;
  - two cancels in a row on one page, and the last booking of a later page called off.

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
      (90 days today), and deleting an owner's account along with their tax values and proofs.
      Closures add: the dates of a private owner's closures are public (their home may be the
      address; #26, confirmed as #31 after the security review), and owners' notes on them last
      until the entry ends (swept). Booking adds: how long plates and drivers' names stay on
      bookings (#35), whether owners should see them only from some days before arrival, failed
      outbox rows (never purged; they hold a place and time), and deleting an account with bookings
      (`bookings.user_id` restricts it). Address search adds (3.2): Mapbox as a processor of the
      addresses drivers type (sent from our server, not kept) and of drivers' IP addresses when the
      results map is opened. Bookings now keep the listing's address (3.3, L6), which for a private
      owner may be their home and outlives later edits of the listing
- [ ] Email in production: Resend's real limit (`ratelimit-limit` on a send). If it is raised, raise
      `EMAIL_SENDS_PER_SECOND` and the web app's pace with it (the transport's default, one a
      second; a code change for now). A stop timeout above 30 s for the worker (see 3.4)
- [ ] Address search in production: `MAPBOX_SEARCH_TOKEN` (no URL restrictions, search scopes only,
      never the public token), the public token restricted to the site's URLs and the map's scopes,
      Mapbox usage alerts, and the hourly budget and per-visitor cap checked against real use
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
