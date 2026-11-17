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

- [ ] Performance, low: a covering partial index for page 1 of a very busy garage, which walks the
      last 31 days. Wait until one exists
- [x] Performance, low: a deadline per email in the sender handing back unsent claims,
      `setGlobalConcurrency(1)` on the email queue, and a closing flag: done in 3.5
- [x] Booking emails marking Greek words in an English listing's words, and names inside
      translated sentences (`t.rich` chunks) marked per run: done in 3.5
- [ ] Manual NVDA (Chrome, Firefox, a Greek voice installed), JAWS, VoiceOver (macOS, iOS) and
      TalkBack:
  - the English search heading switching voice for the Greek words only;
  - an option with a Greek name (voice, and "name, detail");
  - the owner's matches in a Greek and an English listing;
  - the attribution read in English on `/el`;
  - whether any reader honours `lang` inside the "Chosen: …" live region, which decides whether it
    should carry it;
  - two cancels in a row on one page, and the last booking of a later page called off.

### 3.5 Phase 3 follow-ups, second round (2026-11-11)

What 3.4 left open that needs nobody outside the project: the email sender's deadline and its
shutdown, its limit over several workers, and Greek words marked in emails and inside our own
sentences.

- [x] **Implemented**:
  - The sender stops at its 25 s deadline or when the worker shuts down, the send in flight
    included (`send(email, { signal })`; BullMQ's job signal, aborted by `cancelAllJobs` on
    SIGTERM). What it didn't finish goes back to the outbox, due at once and with its try returned
    (`releaseEmails`). A slow Resend no longer stretches a run over minutes, and the platform's
    default stop timeout is enough.
  - The email queue runs one job at a time over every worker process (`setGlobalConcurrency(1)`,
    set by `prepareQueue` at start), so several workers can't pass Resend's limit together.
  - `greekRuns` moved to `@parkfairy/contracts/greek-runs`, for the emails. Booking emails mark
    Greek words in an English listing's facts, and the listing's name in the body keeps its own
    language. Owner emails mark Greek words in English.
  - On the web, `PlaceName` and `placeTag` (for `t.rich`) mark owner text inside our sentences: the
    dashboard's three links ("See … as drivers see it" now has the listing's language too), copying
    to other listings, the held space, the release question. Also marked: space labels everywhere,
    the listing's description, the closures page's name, the driver's bookings list, and a driver's
    name on the owner's bookings page (Greek script only, on an English page).
- [x] **Unit tests**:
  - Worker: slow sends cut at the deadline and the rest handed back; a send in flight stopped and
    handed back with nothing left waiting; a shutdown mid-claim; nothing claimed once stopping; the
    log line; `prepareQueue` setting and removing the limit; shutdown telling jobs to stop after
    closing.
  - Transport: a request in flight dropped, a wait between tries cut short, nothing sent once
    stopped, the timeout still working with a signal; the outbox transport writing nothing.
  - Emails: Greek words in an English listing's address, label and name in both languages; an
    unnamed listing; escaping inside the marking; owner emails.
  - Web: `PlaceWords`/`PlaceName`/`placeTag`; the dashboard's links in Greek with an English listing;
    copying; the booking page, the facts and the list; the owner's bookings (space, driver's name in
    both languages); closures; the listing page's description and spaces; the space list; the
    release question.
  - Integration: `releaseEmails` returning a try, leaving a claim it no longer holds and a lapsed
    one beside a held one; owner emails' payload carrying the listing's language. Claims are
    lapsed by the database's clock, which Docker's can put ahead of the tests'.
- [x] **Smoke test** (`booking.smoke.ts`): both booking emails mark the Greek listing's name in an
      English email. The busy-listing test now uses an English listing with Greek words, a Greek
      «Α1» space and a Greek owner's name: the account's greeting, `/en/owner` and the bookings
      page with axe, then `/el/owner` (the English name inside a Greek sentence) and the Greek
      bookings page (nothing marked in a Greek name)
- [x] **Security** review: nothing above low. Fixed:
  - a long `Retry-After` (a spent quota) cut by the deadline gave the try back every run, for
    ever, and hid the reason. The transport now says what Resend answered before it was stopped
    (`SendStopped.failure`), and such a send counts as failed;
  - a real failure landing as the deadline fired was handed back too;
  - `releaseEmails`'s precondition, stated.
- [x] **Performance** review: nothing high; its medium was the same `Retry-After` loop. Measured: a
      run ends at 25.02 s whatever Resend does, `releaseEmails` 0.25–1.7 ms on 1M rows, the regex
      linear (147 µs for the worst 2,000-character description), `greek-runs` 261 B gzipped.
      Fixed:
  - a job fetched as closing began, which BullMQ can't cancel: the process's own signal
    (`jobHandler`'s `stopping`);
  - claims held 5 minutes, now 2: a crashed worker's emails come back sooner;
  - a pace below 0.04 a second, which would never claim anything, refused.
- [x] **Accessibility** review: nothing above minor. Fixed:
  - the delete-draft button and question;
  - "Remove {label}" on the spaces step;
  - the account's greeting (isolated, as a driver's name is: `PersonName`);
  - owner emails' names in the listing's language;
  - staff's review note marked as a driver's name is.
- [x] **i18n** review: no blocker or major. Fixed:
  - owner emails carry the listing's `contentLocale`;
  - the delete-draft texts;
  - `sentenceWith`'s rule held by a test over every catalog sentence;
  - the name tags held to wrap exactly one argument (`catalogs.test.ts`);
  - Greek checks in the emails and the smoke test.
- [x] **Test** review: no test would pass with the code broken. Fixed:
  - the deadline tests run beside a worker's signal too;
  - BullMQ's three-parameter handler tested (`jobHandler`);
  - a stop during a claim;
  - the real transport across the package boundary;
  - email assertions free of inline styles;
  - claims lapsed by the database's clock;
  - a stop while waiting for a turn;
  - `placeTag` given chunks, with axe.
- [x] **Contracts & docs**: no API or schema change (the outbox payload's new `contentLocale` is
      JSON, optional), memory.md

Left open:

- [ ] Claims sized by the pace alone: above about 1.25 s a send (pace 1/s), each run ends by
      stopping one in flight (no duplicate, an extra call). Size by measured send time if seen
- [ ] Owner text in emails isn't isolated (`bdi`/`dir="auto"`): a direction control in a name
      could reorder a driver's subject line. Earlier than 3.5; staff review limits it
- [ ] The listing page's fallback photo `alt` ("{name}, photo 2") can't mark the name's language
      in an attribute; consider leaving the name out, since the heading names the listing
- [ ] Two replicas: time how long a SIGKILLed sender holds the email queue (stalled-job check,
      30–90 s by the review's reading of BullMQ)
- [ ] Manual checks to add to 3.4's list:
  - links whose name mixes languages, by Tab (focus announcements may ignore inner `lang`);
  - the space radios «Α2»/«B1», and VoiceOver iOS keeping each link one swipe stop;
  - without a Greek voice, what a one-letter run like «Α1» sounds like;
  - TalkBack and `lang` on inline spans;
  - whether Gmail, Outlook.com and Apple Mail keep `lang` on `<span>` and `<td>`.

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

Built in Stripe's test mode, without keys, before #18 and #19 (memory.md #46–#49), in rounds:

- **4.1** Owners connect an Express account for payouts; drivers pay in an embedded Payment
  Element; signed, idempotent webhooks confirm the booking (a late payment kept or refunded, #3);
  the commission a stored setting kept on each booking. Local runs without Stripe keep #33's
  stand-in.
- **4.2** Refunds on cancellation by either side, transfers to owners 24 hours after the stay, the
  ledger and its daily check (done 2026-11-13).
- **4.3** Disputes (#57–#60), and what #18 and #19 answer.

### 4.3 Disputes (2026-11-13)

Decisions #57–#60 (memory.md). Support answers disputes in Stripe's dashboard; the app records
them, prepares the evidence, holds the payout and tells support.

- [x] **Implemented**: `payment_disputes` (migration 0026), filled from `charge.dispute.*` webhooks
      after reading the dispute from Stripe, matched to a booking by its PaymentIntent only (a
      dispute without one is another app's). The booking's facts staged as evidence once, never
      submitted, and never over evidence Stripe holds already (#59); an open or lost dispute
      holds that booking's payout (#58), recorded under the booking's lock and asked again
      before each payee's transfer; a settled dispute never reopened by an older reading;
      support alerted when one opens, is lost (#57), is due within three days with nothing
      submitted, or is lost and still held (`check-money`). Nothing happens to the driver's
      account (#60). The webhook's events listed in `.env.example`, held to the code by a test.
- [x] **Unit tests**: the gateway's dispute read (and evidence already given), evidence staging,
      the events and their list; the worker's `check-money` alerts, a co-owner's transfer looked
      up by their own id, and a dispute recorded mid-page stopping the rest
- [x] **Integration tests** (`payments.integration.test.ts`, "disputes (4.3: #57–#60)", 15):
      recorded, staged once, without the plate; support told once when opened and when lost,
      with ids only; the day's list exactly the disputes due soon with nothing sent; a lost
      dispute already paid not counted as held; a cancelled booking's refund and the stay in
      Athens time; a warning staged; none without a PaymentIntent; nothing over evidence given;
      two deliveries at once as one; a settled dispute kept against an older reading; the payout
      held while open or lost, let go once won, warning_closed or prevented; another app's left
      alone; Stripe refusing the evidence answered 500 and staged when told again
- [~] **Smoke test** (`payments.smoke.ts`): a disputed payment (Stripe's test card for disputes)
  recorded against its booking, open, its evidence staged. Runs only with Stripe test keys, so
  not run locally yet
- [x] **Security** review (2026-11-15): safe in test mode; evidence staged late could overwrite
      support's (now never over evidence given), the hold and the transfer sweep could cross
      (now locked and asked again), an older reading could reopen a settled dispute (now kept):
      fixed
- [x] **Performance** review (2026-11-15): matching by charge read the whole bookings table (now
      the PaymentIntent's unique index): fixed; the lows below
- [x] **Accessibility**: no UI in this round (support works in Stripe)
- [x] **i18n** review (2026-11-15): nothing reaches users (the evidence is in English, for the
      bank; alerts are logs)
- [x] **Test** review (2026-11-15): the alerts, the plate check that couldn't fail, the day's list,
      the held count, the evidence's texts and times, the branches, deliveries at once and out of
      order, the released statuses: all added above
- [x] **Contracts & docs**: migration 0026 reviewed, memory.md, the webhook's events

Left open:

- [ ] Reconciliation against Stripe's balance transactions, disputes and Dashboard refunds
- [ ] What #18 and #19 answer (the accountant, the lawyer, Stripe's eligibility)
- [ ] Before live: check that Stripe's Smart Disputes (or any setting of the account) never
      submits staged evidence by itself; a line on dispute evidence (the driver's name and email,
      the listing's address, to Stripe and the bank) in the privacy notice and the record of
      processing
- [ ] Support's way to decide a lost dispute and let its payout go (Phase 5); meanwhile each
      sweep passes held bookings again (a few ms at scale)
- [ ] A refund owed on a disputed charge is refused by Stripe and retried as "owed for over a
      day": its own alert would say why
- [ ] Staging evidence in a worker job rather than in the webhook's request (two Stripe calls in a
      row there; both safe to repeat)

### 4.2 Refunds, transfers, the ledger (2026-11-13)

Decisions #50–#52. The money moves the worker makes, so the Stripe gateway moved into a package
both the API and the worker use (`@parkfairy/payments`, with `sharesOf`).

- [x] **Implemented** (Stripe in test mode, faked in tests):
  - Refunds when a paid booking is cancelled, by the driver (by its policy) or the owner (in
    full): `owed` in the cancel's transaction, one short try at Stripe after it, `sent` with its id;
    what's left owed the worker sends. A refund that fails at Stripe after it was taken (`refund.*`
    events, checked with Stripe) leaves the ledger, says `failed`, and support is told.
  - Transfers to owners 24 hours after the stay (#4): 90% of what's kept (#50, #51), the sums kept
    before Stripe is asked so a retry sends the same, from the charge (`source_transaction`), only
    to active accounts; restricted owners' wait (#52) and are counted for support after 3 days.
    The owner's payouts page says payouts and bookings wait meanwhile.
  - A ledger (`ledger_entries`: charge, refund, commission, transfer) written with each move, and a
    daily `check-money`: the ledger adds up, no refund owed a day, no transfer waiting for days.
  - The worker's `payments` queue: refunds owed (every 5 min), transfers (15 min), lapsed holds'
    PaymentIntents called off an hour on (15 min, 4.1's open item), the day's check; page by page,
    each run time-limited, stopping when Stripe looks down, a refused row backed off up to 6 hours.
  - The booking page says a cancelled payment charged nothing, and where a refund goes and how long
    it takes; so do the cancellation emails.
- [x] **Unit tests**: the gateway (refunds, transfers, what was made, a refund's state, the quick
      try, a PaymentIntent paid before it's called off, refund events), `sharesOf`, the worker's
      processor (every job, paging, run limit, outage stop, backoff, the key's day, alert levels)
      and its Stripe set-up, env (live keys refused), the booking page, payment step and pending
      payment with a cancelled payment, the payouts page, the emails
- [x] **Integration tests** (`payments.integration.test.ts`, real Postgres, Stripe faked; 58):
      charges entered, refunds for both cancels and a too-late one, Stripe failing (owed, sent
      once), a refund failing later, both sides cancelling at once, another owner kept out, the
      24-hour wait to the minute, a partial refund owed holding the transfer, 90% of what's kept
      adding up and a tampered ledger found, restricted owners waiting and counted, what Stripe
      received entered, a charge named late, keyset pages with equal microseconds, the backoff,
      lapsed payments called off (never a held one or one the bank is deciding), cancelled
      payments' rows deleted, the stale-hold sweep sparing rows with money
- [~] **Smoke test**: the key-gated run now cancels the paid booking and checks the refund at
  Stripe and the ledger, in both languages; skipped until test keys exist (#47). Without keys,
  a cancel of an unpaid booking enters nothing (`booking.smoke.ts`), and the worker's
  readiness covers the payments queue. Transfers have no end-to-end run
- [x] **Security** review: nothing critical or high. Fixed: a refund failing after Stripe took it
      (M1: the refund events), CHECKs stating their nulls and holding a transfer to what's kept
      and to a settled refund (L1), a transfer marked only while still due (L2), refunds owed a day
      reported with or without Stripe (L3), lapsed paid holds backed off (L4)
- [x] **Performance** review: nothing high. Fixed: refunded-in-full bookings out of the transfers
      index, each sweep time-limited with an outage stop and one network retry, the cancel's
      Stripe try capped at 3 s, transfers every 15 minutes, "what was made" asked only past the
      key's day and split in two, refused rows backed off, the ledger check driven by recent
      entries, the stale-hold sweep guarded against ledgered rows
- [x] **Accessibility** review: nothing serious. Fixed: a payment cancelled at Stripe goes to the
      page that says the hold ended (never "try again"), says nothing was charged, and a let-go
      hold's page gets a heading to land on; the smoke run waits for the title and checks Greek
- [x] **i18n** review: fixed the cancelled payment's message, where a refund goes and how long
      (page and emails), the payout statuses (bookings and payouts wait while Stripe checks or
      can't pay) and the lead (Stripe pays the bank on its schedule), «Επιλέξτε την ξανά»
- [x] **Test** review: the three highs (the 24-hour wait, a refund owed holding the transfer, the
      race) and the mediums and lows added, but the worker against a real database (M12)
- [x] **Contracts & docs**: migrations 0022–0024 reviewed, OpenAPI and client regenerated (the
      `canceled` payment status), `.env.example` (the worker's key), memory.md

Left open:

- [ ] The worker's sweeps run against a real database only through the API suite's calls of the
      same functions: an end-to-end worker suite (test review M12)
- [ ] Owner's email about a driver's cancellation could say the owner is still paid their share
      of what's kept (i18n m6, product's call)
- [ ] The Stripe endpoint must send `refund.updated`, `refund.failed` and `charge.refund.updated`
      (with `payment_intent.*` and `account.updated`) once keys exist; a restricted key for the
      worker (refunds, transfers, PaymentIntents)
- [ ] A refund that failed is support's to settle: no screen for it yet (Phase 5), and the
      driver's page still reads as refunded
- [ ] Reconciliation against Stripe's balance transactions, disputes, Dashboard refunds: 4.3
- [ ] Migrations lock `bookings` while CHECKs validate and indexes build: fine at today's size,
      `NOT VALID`/`CONCURRENTLY` once there is real data (perf L7)
- [ ] Native speaker: Owner.payouts.lead and status.*, Booking.paymentCanceled, refundToCard, the
      cancellation emails' refund sentences

### 4.1 Payouts set up, bookings paid for (2026-11-11)

- [x] **Implemented** (Stripe in test mode, faked in tests; no keys yet):
  - Owners set up payouts in Stripe's Express onboarding (`/owner/payouts`, a card on the
    dashboard): one account per owner (`payout_accounts`), its state from Stripe's
    `account.updated` and a look of our own while not active; the Express dashboard once set up.
  - A listing is bookable only once its owner can be paid (#5): `bookingOpen` and the hold.
  - The commission is a stored setting (`platform_settings`, 10%), copied onto each booking at the
    hold (`bookings.commission_bps`, #15).
  - Drivers pay in the Payment Element on the booking's page (#49): the plate is kept, the booking's
    one PaymentIntent made (Stripe outside the locks), and the booking confirmed when the money is
    in, by Stripe's signed webhook (`/v1/payments/webhook`, raw body, deduplicated in
    `stripe_events`) or the page asking (`/payment/settle`). A late payment keeps the booking while
    the space is free and is refunded in full otherwise (#3); so is one for a hold let go or an
    amount not the booking's. A payment the bank is still deciding on is said so, and looked at
    again quietly.
  - The booking page alone lets Stripe's scripts and frames in (CSP), and every way into it loads a
    real page (`BookingLink`, the hold's redirect).
  - Without Stripe a local run keeps the stand-in Confirm (#33, #47); with it, never.
  - Live keys are refused (`sk_live_`, and only `pk_test_` on the web) until #18 and #19.
- [x] **Unit tests**: the gateway (account and payment states, idempotency keys, errors without
      Stripe's message, real signatures), env, contracts, the CSP, the hold form's page load, the
      paying form, the Payment Element step (with Stripe mocked), the pending payment, the payouts
      button, page and card, the booking page's paying states, `BookingLink`
- [x] **Integration tests** (`payments.integration.test.ts`, a fake Stripe in memory): payouts end
      to end, the webhook's signature and ordering, paying, confirming once, settling, late
      payments kept and refunded, refunds for a released hold or a wrong amount, Stripe failing,
      another driver kept out, the stale-hold sweep keeping paid-for holds
- [x] **Smoke test** (`payments.smoke.ts`): without Stripe, the payouts page in both languages and
      the webhook's 404; the CSP on the booking page only. A key-gated run (pay with 4242 in the
      Payment Element, booked) is written and skipped until test keys exist
- [x] **Security** review: two highs found and fixed, and confirmed closed by a re-check (with
      both mediums), which found one new low, fixed as far as it can be before 4.2 (N1 below).
  - H1: settling a paid booking cancelled since refunded it in full, past its policy. A booking
    once confirmed now keeps its money; its refunds are its cancellation's (4.2).
  - H2: a refund decided in one transaction and made after it let a second settle confirm the
    booking in between. The refund is now recorded (`refunding`) under the booking's lock before
    Stripe is asked, the confirming update runs in a savepoint, and a refund that fails half way is
    finished by the next look.
  - Fixed too: a late payment for a stay already begun is refunded; payments are cards only (no
    method that settles days later); `GET /owner/payouts` throttled per account and asking Stripe
    at most once a minute; answers parsed through their contracts and Stripe links only followed;
    both webhook secrets accepted (the platform's and Connect's); the plate cleared on a refund;
    `stripe_events` purged after a week; Stripe's parameters taken out of the address back from
    the bank; a payment for a booking another environment made left alone.
- [x] **Performance** review: nothing high. Fixed: the page's looks at a payment (backed off,
      paused while hidden, under the route's limit), a settle that asks Stripe nothing once settled
      and writes nothing unchanged, the dashboard reading payouts beside the onboarding, the
      payouts status from the database within a minute, `@stripe/stripe-js/pure` and the step's
      code fetched while the plate is typed, links to bookings made staying client navigations,
      the stale-holds index without paid-for holds, ignored webhook events not recorded, the
      payouts page in the budget tests. Open below
- [x] **Accessibility** review: nothing above serious. Fixed:
  - Stripe's fields in our colours (hex held to the tokens), dark with the system's dark;
  - the hold renewed when going to pay with little left, and never ended mid-payment;
  - the return from the bank settled at once, and a payment not made said so;
  - the payment heading through `FocusHeading`, a loading status, Pay once ready, a load failure
    said with a retry;
  - the pending payment: quiet looks, a press that says what it found, a refusal that moves on;
  - the plate changeable before paying, letting go held back while paying;
  - titles and badges by what the booking is about (paying, refunded).
- [x] **i18n** review: no blocker. Fixed: Pay or Confirm by how the hold is completed ("Complete
      your booking"), "nothing was charged" only where true, a driver email for a refund, the
      payouts checks and wording (Stripe can't pay you yet; once live), Greek wording (κράτηση
      rather than θέση "closing", the card's statement, «Πληρωμές προς εσάς»), the return URL
      built by the router
- [x] **Test** review: no test would pass broken. Fixed: the suite run as production has it (no
      stand-in beside Stripe), Stripe's keys blanked in tests, failure and retry, concurrency, the
      metadata fallback, the gates without and with Stripe, the payment states through the
      webhook, unknown bookings, the stale-hold control row, web env, error codes in both
      catalogs, Greek amounts
- [x] **Contracts & docs**: OpenAPI and client regenerated, migration 0021 reviewed (a default
      backfilled then dropped, the settings row seeded), `.env.example`, memory.md

Left open:

- [x] Cancelling a paid booking records the refund but sends no money back until 4.2; transfers
      to owners and the ledger are 4.2 too (done in 4.2)
- [x] The PaymentIntents of holds that lapsed unpaid aren't cancelled at Stripe (4.2, with the
      worker able to call Stripe); until then their rows are kept, with the plate cleared only
      on a refund (done in 4.2: called off an hour on, the plate cleared, the row then goes).
      Retention of Stripe's data: Phase 6 (#18)
- [ ] The webhook asks Stripe for the PaymentIntent before answering; under a burst, a queue job
      would answer faster (perf M3)
- [x] A booking left `refunding` because Stripe failed and nobody came back is retried only while
      Stripe retries its webhook (3 days): a worker sweep with an alert, in 4.2 (N1). One refunded
      at Stripe with our write lost is recorded at the next look, without asking Stripe again
      (done in 4.2: `send-refunds`, and `check-money` reports one owed a day)
- [ ] Erasing an account (Phase 6) must anonymise bookings with a PaymentIntent, never delete
      them: a payment for a booking this database doesn't have is left alone, not refunded
- [ ] Stripe's own decline messages are shown for cards; check they come in Greek on `/el`, and map
      the common codes to ours if not
- [ ] Native speaker: the payment and payouts copy (Booking.continueToPayment … paymentRefunded,
      Owner.payouts.*, the refund email), «η Stripe», a word for payouts apart from drivers'
      payments (πληρωμές προς εσάς / εκκαθαρίσεις / εισπράξεις), «Πληρωμή 4,00 €» on the button

**Try with the real thing** (needs Stripe test keys, decision #47):

- [ ] The key-gated smoke run, and `stripe listen --forward-to localhost:4000/v1/payments/webhook`
      (and the Connect endpoint's secret beside the platform's in `STRIPE_WEBHOOK_SECRET`)
- [ ] An Express onboarding in test mode, back to `/owner/payouts`, both languages; whose language
      Stripe's onboarding speaks with a Greek page and an English browser
- [ ] Test cards: 4242 (paid), 4000 0025 0000 3155 (3-D Secure, complete, fail and close the
      frame), 4000 0000 0000 0002 (declined), 9995 (funds), 0069 (expired), 0127 (CVC), 0119
      (processing error), on `/el` and `/en`, light, dark and the system's dark
- [ ] Screen readers (NVDA with Chrome and Firefox and a Greek voice, JAWS, VoiceOver on macOS and
      iOS, TalkBack): Continue to payment, the Element's fields and errors, a decline, the 3-D
      Secure dialog, the hold warning while paying, the pending payment's looks, the refund
      notice, the payouts buttons and the return from Stripe
- [ ] Contrast measured inside Stripe's frame, a Windows contrast theme, 320 px, 200% zoom,
      reduced motion

## Co-ownership (2026-11-13)

Decisions #53–#56 and the readings under them (memory.md). Added at the product owner's request
between 4.2 and 4.3.

- [x] **Implemented**:
  - `listing_owners` (the primary, the listing's `owner_id`, and co-owners, each with a share) and
    `listing_invites`; every ownership check reads them, so co-owners run the listing (edit it, its
    hours, prices and closures, see and cancel its bookings, invite); the primary alone removes
    owners, sets the shares and deletes (403 `PRIMARY_ONLY`). Co-owners can leave; a leaving or
    removed owner's share goes back to the primary. Ten owners and open invites at most.
  - Invites by email: the worker makes the link's token as it sends (only its hash kept, a new
    idempotency key for each), the token after `#`; accepted only by the account with that
    verified address, which gets an owner profile if it has none; 7 days; withdrawn by the
    inviter or the primary; purged a month after.
  - Payees copied when a booking is confirmed, by share; transfers split by largest remainder,
    each payee paid on their own (a restricted one waits alone), the ledger per payee.
  - Bookable only while someone is paid and every owner with a share can be; every owner hears
    of bookings, each under the per-driver cap.
  - Web: the listing's owners page (shares, invite, invitations, remove, leave), the invite page
    (signed out it keeps the token for the tab and asks to sign in), the dashboard's way there.
- [x] **Unit tests**: contracts, `splitShares`, the gateway's per-payee transfer, the invite
      email (nothing an owner typed in it; its days the invite's), the worker (invite email
      minted per send, nothing for a closed invite, per-payee transfers with a restricted
      co-owner and a part of 0, the purge), the owners panel (per-field refusals, the focus kept
      where someone moved, the next invitation's button, two presses each), the invite page and
      its token (a failed sign-out said), the proof step as a co-owner, every refusal translated,
      both pages
- [x] **Integration tests** (`listing-owners.integration.test.ts`, 25; `owner` and `payments`
      co-owned): the primary at 100%, invite → minted → preview → accepted by the right account
      only (a refused one makes no profile), rights of each role, shares (refused naming whose
      details aren't in; a share sends its owner to staff), leave and remove (their invites
      withdrawn), the limits, the invite caps (which one, per listing) and a lapsed invite, a
      co-owner's try at an address already here counted, what a co-owner sees, the invite's
      language and its outbox row empty of anything typed, no reminder for a co-owner, a
      co-owner removed while their cancel or edit waits on the lock doing neither, strangers,
      the dashboard, bookings telling every owner with payees copied by share; sending in needs
      the primary's and every paid owner's details, not an unpaid co-owner's; proofs and their
      names the primary's; with Stripe, bookable only when every owner with a share can be
      paid, and each paid their part
- [x] **Smoke test** (`co-ownership.smoke.ts`): invite by email through the worker, the link
      opened signed out, sign in, the invite page in both languages, accept, what a co-owner
      sees, shares refused at the co-owner's field until their details are in, then saved,
      Greek, axe; `/owner/invite` in the a11y list; the
      new routes' origin checks (`security.smoke.ts`); the owners page and the invite page,
      signed in and out, under the first-visit budget (`performance.smoke.ts`)
- [x] **Security** review (2026-11-13): a removed owner back in through their own invite (their
      invites now go with them), invite spam (caps), payees without their details and tax for
      DAC7 (a share needs them; so does sending in, for every paid owner), proofs open to every
      co-owner (now the primary's), co-owners seeing each other's addresses and Stripe state
      (names only), a refused accept leaving a profile, membership rechecked under the locks in
      edit and owner cancel: all fixed. Second round (2026-11-15): the listing's name (an
      owner's free text) out of the invite email; the day's cap counted under the inviter's
      lock; a co-owner's try at an address already here counted, so it tells nothing for free;
      owner cancel and copies read membership after the lock, not before; a share sends its
      owner to staff to verify; proof file names the primary's: all fixed
- [x] **Performance** review (2026-11-13): the two pages missing from the budget (added); 0025's
      lock pattern, harmless before launch (the post-launch pattern in memory.md); the lows below.
      Second round (2026-11-15): the invite's language looked up by `lower(email)` (every account
      read per invite), the caps' counts unbounded by their windows, the auth client in the
      invite page's first load: fixed
- [x] **Accessibility** review (2026-11-13): the owners panel's announcements, focus after remove,
      withdraw, leave and a full listing, the shares' hint, unit and total error, the two-press
      confirm's description, one stable status line on the invite page, and a way to sign out
      when the invite is another address's: all fixed. Second round (2026-11-15): which owner's
      details hold a share back, said at their field (the primary's own with links to the
      steps); the total's error described, not an alert; the focus left where someone moved
      meanwhile; withdraw's focus to the next invitation; a failed sign-out said; names in labels
      and announcements isolated; the status read whole; the tab retitled after leaving: fixed
- [x] **i18n** review (2026-11-13): names isolated with `<bdi>` in rich text, dates in `<time>`,
      plurals for days and room, no gendered words for the person invited, the invite's email
      in the invitee's language, Greek titles and labels: all fixed. Second round (2026-11-15):
      the details refusal names the steps and whose share; which invitation cap was met; the
      email's days tied to the invite's; names in labels and announcements; wording: fixed
- [x] **Test** review (2026-11-13, again 2026-11-15): a refused accept making a profile and a
      co-owner reminded to onboard were bugs (fixed, with tests); the co-owner's transfer lookup,
      the two presses, the lock rechecks (checked to fail without the fix), the email's days,
      the leave focus, a sign-out failure, a token kept on a failure of ours: added
- [x] **Contracts & docs**: migration 0025 reviewed (backfills: every listing's owner its primary,
      every confirmed booking's payee), OpenAPI and client regenerated, memory.md

Left open:

- [x] Handing the primary role to a co-owner (2026-11-15, decisions in memory.md): built, tested and
      smoked; see "Handing over the primary role" below. Open there: the native-speaker pass
- [ ] Native speaker: `Owner.owners.*`, `Owner.invite.*`, `Owner.errors.TOO_MANY_INVITES`,
      `Owner.errors.OWNER_DETAILS_MISSING`, `Owner.dashboard.owners`, `Owner.proof.primaryOnly`,
      the invite email; «Κύρια ιδιοκτησία» and «Συνιδιοκτησία» as role names; whether «ο κύριος
      ιδιοκτήτης» and «# ιδιοκτήτη» should become «μέλος» wording; «ισχύει έως» or «έως τις»;
      «να αθροίζουν 100%» here and in `Validation.sharesTotal`, both or neither
- [x] Security residual (2026-11-15): a paid owner can no longer make their details incomplete
      (a field emptied, a switch of kind that drops the birth date or registration number) while a
      listing with staff or live pays them: 409 `PROFILE_HAS_SHARE`, said on the profile form beside
      the autosave status. The share check and the save lock the profile row against each other
      (tested by holding one side's lock; each lock removed fails its test). Security review: a
      lock upgrade that could deadlock two shares or submissions fixed (`no key update`, id order),
      and the primary no longer locked out on drafts. Test review: both race tests made
      deterministic, other kind of switch, every field, a share on a second listing, `saveTax`, the
      form's refusals in both languages. Sending in still checks the details, as a second line
- [x] Smoke (2026-11-15): `co-ownership.smoke.ts` has the refusal: a co-owner paid a share of a
      listing with staff empties their phone and the page says why, then replaces it and the
      message goes
- [x] Security residual (2026-11-15): invitations to one listing are counted per inbox, `+tag`
      stripped (`a+1@x`, `a+2@x` and `a@x` share the week's two). Still open, by design: the same
      address may be asked to another listing (a day's 20 from one owner is the bound), and dotted
      Gmail variants count as different inboxes (stripping dots is Gmail's rule, not every
      provider's)
- [ ] Accessibility advisories: withdrawing is one press, and with two invites a week per address
      a mistaken one can't always be redone at once; the panel's status line sits at its top,
      far from the button at 200% or 320 px, and moves what follows once it has text
- [x] Performance lows done (2026-11-15): telling every owner of a booking is one grouped query
      (`driverEmailsToOwners`, tested per owner on a co-owned listing); `setShares` is one statement
      (tested with three owners and a foreign id).
- [ ] Performance lows, left for scale: `markTransferSending` updates row by row; `change()` reads the answer inside the listing's lock; signed in, the
      invite page carries the whole owner catalogue; the owners page's metadata asks the API
      before a signed-out visitor is sent to sign in; past the key's day, `transferMadeFor` lists
      a booking's transfers once per payee; `bookableColumns.ownerUserId` is no longer read

### Handing over the primary role (2026-11-15)

Two steps (offer by the primary, accept by the co-owner), the old primary staying as a co-owner
with their share, the new one needing details, tax, an active payout account and room under the
listing limit, and the role's rights (removal, shares, deeds, deletion, status emails) moving with it.

- [x] **Implemented**: `listing_handovers` (migration 0028); `POST …/handover`,
      `POST …/handover/accept`, `DELETE …/handover` (withdraw by the primary, decline by the
      co-owner); readiness checked at the offer and again under the listing lock at the accept; an
      offer ends when its co-owner leaves or is removed, lapses after 7 days, and is replaced by
      the next; the owners page's handover card (two presses each, focus and announcements)
- [x] **Unit tests**: contracts, the card (offer, take back, accept, decline, refusal, nothing for
      a co-owner with no offer, Greek, axe)
- [x] **Integration tests** (`listing-owners.integration.test.ts`): the swap and its rights, who may
      offer and to whom, readiness (details, payouts), withdraw and decline, lapse and replace,
      removal, a payout that went wrong before the accept, and a primary demoted while their
      deletion waited on the lock (fails without the fix)
- [x] **Security** review: no bypass. Fixed: a demoted primary's deletion of a draft or a deed
      racing the accept (the role is now read under the lock); the new primary set to pending for
      staff's verification
- [x] Performance review: nothing above low; fixed the cascade's missing index (migration 0029) and
      the stale comment on the inbox cap. Accessibility review: focus lost when a co-owner declines
      (now the owners heading; focus asserted in tests). i18n review: the payouts and listing-limit
      errors read wrongly for the primary making the offer, Greek aspect, gender and date wording:
      fixed. Left: a stale-offer error keeps its confirm button until reload; the payouts error has
      no link; the lock held for the extra `read()` query (sub-millisecond)
- [x] **Smoke test** (`co-ownership.smoke.ts`, 2026-11-15): a refusal while payouts aren't set up,
      "No" leaving things as they are, the offer, the co-owner's email from the worker, their page
      (offer, payouts link, Greek, axe), taking over with focus, the old primary a co-owner who is
      emailed. The handover part needs the database (a payout account is made by hand)
- [x] **Emails** (2026-11-15, migration 0030): the co-owner is told of an offer (at most one a day per
      listing and co-owner) and the old primary of the acceptance (`packages/email/src/handover-emails.ts`).
      The new primary has just pressed the button, so isn't mailed. Nothing an owner typed is in
      either: the link carries the listing's id only. Tested in the email package, the worker, and
      the integration suite (nothing queued for a refused offer or accept)
- [x] Handover UI (2026-11-15): an offer found stale (withdrawn, lapsed or accepted meanwhile) makes
      the page read itself again, say so and move the focus to a heading that stays; if the re-read
      fails the question keeps its alert. The co-owner offered the role gets a link to their payouts
- [x] Security low: withdrawn and lapsed offers are purged after 30 days (`purge-listing-handovers`);
      accepted ones stay as the record of who handed a listing to whom
- [ ] Security lows left: `transferMadeFor`'s `primary` is read live from the listing (only matters
      for a legacy transfer without owner metadata retried after a handover); an offer's
      `TOO_MANY_LISTINGS` tells a primary that their co-owner owns that many listings; accepted
      offers restrict deleting either profile (Phase 6's erasure work must decide); the old primary
      can no longer open the deeds they uploaded (GDPR access is support's); a second offer to the
      same co-owner the same UTC day is not emailed
- [ ] Native speaker: `Owner.owners.handover*`, `handoverStale`, `handoverPayoutsLink`, `keepOffer`,
      `Owner.errors.HANDOVER_*`, `PAYOUTS_NOT_ACTIVE`, and the `el` block of
      `packages/email/src/handover-emails.ts` (especially «συνιδιοκτείτε», «παραδόθηκε», «μέλη»)
- [ ] Manual NVDA and VoiceOver: the stale-offer message and focus on both sides; the payouts link

## Phase 5: Owner and admin dashboards

### 5.1 Owner calendar, bookings and earnings (planned 2026-11-15)

Decisions #65–#68 (memory.md): the owner side first; admin approvals follow in a separate app.
Scope as planned, to confirm while building: one cross-listing bookings list for every listing an
owner co-owns (keyset pages, filter by listing, status and dates); a calendar of a listing's stays
by day and space, in the listing's time zone, with a list equivalent for screen readers; earnings
from `booking_payees` and the ledger: what each payee is owed, what has been sent, what waits (a
restricted account, #52; a dispute, #58), by month and by listing. Amounts are the owner's own
part after commission (#50, #51), never another co-owner's. Gross, commission and VAT wait for #18.

Built 2026-11-15: earnings (`GET /owner/earnings`, `/owner/earnings`) and the calendar
(`GET /owner/calendar`, `/owner/calendar`), linked from the dashboard. Readings in memory.md.
Built 2026-11-16: the bookings list across listings (below). Not built: a grid view, and gross,
commission and VAT (#18).

- [x] **Implemented** behind the API's authorization rules (no client-trusted roles/IDs): earnings,
      calendar and the bookings list across listings
- [x] **Unit tests** next to the code (`*.test.ts[x]`) for logic, guards, components
- [x] **Smoke test** `tests/smoke/specs/owner-earnings.smoke.ts` and `owner-calendar.smoke.ts`
      (both languages, 320px, no table scrolling sideways, the filter without scripts)
- [x] **Security** review: co-owners see only their own payee rows and amounts (isolation of
      sums, counts, lines and waiting list tested); a new co-owner sees no earlier stay
- [~] **Performance** review: keyset page and calendar window use their indexes (measured on 300k
  bookings); pool use and later pages fixed. Open, low: the per-listing sum joins `bookings` (a
  `location_id` on `booking_payees` would drop it), the totals read the owner's rows, the
  calendar joins `users` before its limit, and a full refund leaves an open payee row for good
- [~] **Accessibility** review: real tables with captions and row headers, cells wrap, list
  calendar, filter without scripts; axe in both languages at 1280 and 320px. Open: a manual
  NVDA and VoiceOver pass over the tables in Greek and what is heard after Next month
- [~] **i18n** review: both catalogs, plurals agree in count, months and dates by locale; Greek
  uses «χώρος» and «στάθμευση» as the rest of the catalog. Open: a native speaker on the new
  Greek (`Owner.earnings`, `Owner.calendar`)
- [x] **Contracts & docs**: OpenAPI/client regenerated, memory.md updated

#### 5.1b Bookings across listings (2026-11-16)

`GET /owner/bookings` and `/owner/bookings`, linked from the dashboard: upcoming, past and cancelled
bookings of every listing the account owns, co-owns or manages, by listing and by the days stays
start on (readings in memory.md).

- [x] **Implemented**: contract `owner-booking-list.ts`, `OwnerBookingListService` (keyset paging on
      (start, id), a window of days for past and cancelled, a new member reads no history), the
      page, the view, the dashboard link, both catalogs
- [x] **Unit tests**: contracts (37), the view (21), the page (13), the loader, the dashboard link,
      the catalog guard against «παραμονή». **Integration** (`owner-booking-list.integration.test.ts`,
      20): authorization, owners, co-owners and managers, the joined rule for stays and for
      cancellations, three pages and back, ties on one instant across listings, a window with a
      listing, the probe, the 30-day bound, the Athens day against UTC's
- [x] **Smoke** `owner-bookings-list.smoke.ts` (3): the three groups, a listing, days, refused days
      (title, link to the field, description), a bad query starting over, Greek at 320 px, CSP; the
      pages in `accessibility.smoke.ts` (both languages) and `performance.smoke.ts`
- [x] **Security** review: no critical, high or medium. Fixed: a booking called off before a member
      joined was readable to them through its later stay (low), history limited to the calendar's
      24 months until retention is set, `sql.raw` taken out of the cursor comparisons
- [x] **Accessibility** review: fixed the silent refused-days error (alert before the form, linked to
      the field, in the title), one message per mistake and only the last day marked for the order,
      the group in the page title and a heading, the days in a fieldset, `lang` on an unnamed
      listing's option (the calendar too), wrapping of long owner text, the cancellation date in
      `<time>`, the days reset when the group changes. Open: a manual NVDA and VoiceOver pass
- [x] **i18n** review: «στάθμευση» for a stay, «Επερχόμενες» as the driver's list says, one rich
      message for the link's hidden words, «Ποιος ακύρωσε», the limit in the message from the
      constant. Open: a native speaker on `Owner.bookingList`
- [x] **Test** review: paging beyond two pages and ties, the manager's joined rule, under way against
      past, the probe, the loader, DST days in the contract. Open: a DST test through the API, the
      stay's range in the booking's own zone, a manager's list in `listing-managers.smoke.ts`
- [x] **Performance** review (3M bookings, 105 listings, measured by the reviewer): the first shape
      joined every in-window booking before its limit, 0.8 s for 90 days and 3–5 s (past the 3 s
      statement timeout) for 366 days. Fixed: each listing gives its own page from its index in a
      lateral, then only those rows are sorted and joined to drivers (measured 17–36 ms, same first
      pages), exact per-listing day bounds instead of `to_char`, a partial index for called-off
      bookings (migration 0045), at most two queries at once, 60 pages a minute per account. Open,
      low: the `upcoming` group is 0.25 s at 100 listings (the planner underestimates 871 rows; an
      ordered-scan rewrite measured 50 ms), a filter list of 100 listings at most, and the real
      first-visit JS (estimated 167 KiB, the same as the calendar) in the next full smoke run
- [x] **The gate** (2026-11-17): typecheck, build, `db:migrate` twice, `db:generate` and `api:generate`
      without changes, unit and integration tests (939 API, 1156 web) and `test:smoke` (278 passed,
      4 skipped) green. One web test (`date-time-field`, not touched here) failed once under the
      load of the whole run and passed alone and on a rerun: watch for it. Lint and format were
      checked on the files of this change only: the repo was being moved to import sorting
      meanwhile (`simple-import-sort`), so `pnpm format:check` fails on files of that work
- [ ] **Open**: gross, commission and VAT in earnings still wait for #18 (memory.md)

### 5.3 Managers (2026-11-15, decisions #69–#71)

A third role on a listing besides owner and co-owner: runs it day to day (calendar, bookings and
cancelling, closures and special hours), no share, no earnings, no edits, no invites, no proofs. The
primary owner adds and removes them by the emailed invite; an account is enough.

- [x] **Implemented** behind the API's authorization rules: `listing_managers`, role on invites,
      `runsListing` for exactly the manager's routes; owners' page (managers card, role choice),
      invite page, dashboard card
- [x] **Unit tests** (contracts, email, worker, web) and **API integration tests**
      (`listing-managers.integration.test.ts`)
- [x] **Smoke test** `tests/smoke/specs/listing-managers.smoke.ts`
- [x] **Security** review: no way found for a manager to reach an owner-only route or become an
      owner; fixed: cancelling is throttled per account, a handover withdraws the old primary's
      open manager invites, and an owner-side cancellation now records the account
      (`bookings.cancelled_by_user_id`) and emails the primary when it was a co-owner or a manager
      (by role, never by name). Open, low: a manager sees each booking's total (kept: the price a
      driver paid, not earnings), a co-owner can learn that an address has an open manager invite
      (as with co-owner invites today)
- [x] **Performance** review: the calendar's first join was a regression (a lateral read every
      booking of the platform); now a plain join and `id in (…)`, measured by the reviewer at
      0.4 ms for a typical owner and 33 ms for 150 listings
- [~] **Accessibility** review: heading order fixed on the landing, the invite form picks a role with
  room and blocks a full one, managed listing names are headings. Open: a manual NVDA and
  VoiceOver pass (the radio group's legend and descriptions, the removal announcement)
- [~] **i18n** review: «διαχείριση» now only for managers and owners "have full control"; the
  chooser is gender-neutral. Open: a native speaker on the new Greek
- [~] **Test** review: authorization, replay, cross-listing, closures, visibility, calendar scope,
  the queue's role and the handover case are covered. Open: a cancel racing a removal and two
  accepts at once (both held by the listing lock), `claimDueEmails` under a real worker
- [x] **Contracts & docs**: client regenerated (stable, 2026-11-16), memory.md updated (decisions #69–#71 and our readings)

### 5.2 Admin approvals and the audit log (2026-11-15, decisions #66–#68)

Staff review what people sent in, in a separate admin app (#66) on the one API. Built in slices:
5.2a the API and the audit log (done below), 5.2b the admin app (sign-in with a second factor, the
queue, a review page, the log), 5.2c the rest of the Phase 5 list (moderation, users, bookings,
payments, overstay reports, removing two-factor).

- [x] **5.2a Implemented**: `GET /admin/listings` (queue by status, oldest first, never a draft),
      `GET /admin/listings/:id` (owners with tax as their last three characters, proofs),
      `GET /admin/listings/:id/proofs/:proofId` (a download; opening one is logged), `POST
…/approve` and `…/request-changes` (decided once, under the listing's lock; never by an
      owner or manager of it), `GET /admin/audit`; every route `@Roles('admin')` with a second factor
- [x] **Audit log** (#68): `audit_log`, one line per change and per proof opened, written in the
      change's own transaction; the database refuses an update, a delete or a truncate (trigger,
      migration 0036), and an account that acted can't be deleted (restrict)
- [x] **Unit and integration tests** (contracts, `admin.integration.test.ts`, 53)
- [x] **Smoke test** `tests/smoke/specs/admin.smoke.ts` (what a visitor and an ordinary account
      meet: 401, 403, and a write from another site refused on its origin); the staff's own paths,
      which need a second factor, are in the integration tests, and the admin app (5.2b) adds the
      end-to-end ones
- [x] **Security / Performance / Test** reviews of 5.2a: done. Fixed: the log's order matches its
      index (a mismatch sorted the whole log per page), the triggers fire always, approving re-reads
      owners' details, no proof from a link on another site, no bidi characters in a note, and the
      test gaps (rollback, ties, several owners, self-review, races). Open, low: the queue sorts
      every listing of a status (an expression can't be indexed; fine to ~100k), the staff
      account and note are kept for good (retention, Phase 6)
- [x] **5.2b The staff app** (2026-11-15, #72, #73): `apps/admin`, a second Next app on its own origin
      and policy. Sign-in with a second factor, the queue, a listing's review with the decision, the
      audit log, both languages; an admin without a second factor, and any other account, see why and
      no data. Only sign-in and sign-out of Better Auth are served there. Made staff by hand
      (GETTING_STARTED.md)
- [x] **5.2b Unit tests** (194 in the app): the auth allowlist and route (every method), the `trustDevice`
      refusal, env, CSP (exact directives), proxy, session (`disableRefresh`, redirect, logging),
      `getAuth`, the loaders' status mapping, redirects (hostile `next`), every page and form in both
      languages with axe, catalog parity and the enums it must name
- [x] **5.2b Smoke test** `admin-app.smoke.ts` (7): policy and the only doors, a foreign origin on
      sign-in, sign-in and back through a deep link and the second step, a hostile `next`, an ordinary
      account, staff without a second factor, the whole review (send back, approve, log, filters),
      Greek at 320 px, host-only cookie, JS budget per page, no CSP violations
- [x] **5.2b Security** review: no critical or high. Fixed: production needs its own hostname and
      https for `ADMIN_URL` (cookies ignore ports), the staff origin stays out of the public site's
      `TRUSTED_ORIGINS` (the API takes it from `ADMIN_URL`), proof downloads only same-origin,
      `trustDevice` refused, the rewrite narrowed to `/v1/admin`, `API_URL` required, redirect
      hardening. Open: a shorter staff session or `SameSite=Strict` (memory.md)
- [x] **5.2b Performance** review: nothing high. Fixed: the auth client left the layout (13 KiB on
      every page), budgets in the smoke suite, the pool's `error` event (all apps). Open, low: the
      queue's order can't use an index (`published` is every listing: add one if it is slow at about
      10,000), no `loading.tsx`, cold start of `getAuth`
- [~] **5.2b Accessibility** review: fixed the question's focus, notices that clipped or shouted, row
  headers, long names wrapping, "not given" in words, the backup code's hint, heading level.
  Open: a pasted code with a space is refused (the shared `TotpInputSchema`, the public site too),
  a 401 has no link back to sign-in, a manual NVDA and VoiceOver pass over the review, the
  question and the tables in Greek, 200% text on a phone
- [~] **5.2b i18n** review: Greek says «χώρος» and the public site's terms; `lang` only on owners' own
  text; unknown log entries said generally. Open: a native speaker on `apps/admin/messages/el.json`
  (the reviewer's list: «απόδειξη» for the lease proof, «Ποιος/Τι» as headings, «διαχειριστής» for a
  manager next to the platform role, the status words against the public ones); the space list and
  country codes are not locale-formatted
- [~] **5.2b Test** review: P1 and P2 done. Open: ports of `focus-heading`, `form-field`, `route-focus`
  and error-page tests, `standing-notice`/`missing-notice` direct tests, the layout's `staff` flag
  unit test, an exhaustive allowlist test against Better Auth's endpoint list
- [x] **5.2b Contracts & docs**: no contract or schema change; README, GETTING_STARTED, `.env.example`,
      CI, memory.md
- [x] **5.2c** moderation, users, bookings, payments, overstay reports, removing two-factor: built in
      order (#74–#85); 5.2c1 to 5.2c4 below are done

#### 5.2c1 Accounts and removing two-factor (2026-11-15, #13, #77)

- [x] **Implemented**: `POST /admin/users/lookup` (a whole address in the body, the id back),
      `GET /admin/users/:id` (the account's page, logged as `user.viewed`), `POST
/admin/users/:id/remove-two-factor` (note; ends every session, revokes the password, clears old
      reset links and trusted devices, emails the address, `user.two_factor_removed`; never on staff or
      on yourself); `/users` and `/users/[id]` in the staff app, both languages; migrations 0038, 0039
- [x] **Unit and integration tests**: contracts, the `two-factor-removed` email, the worker, 38 API
      integration tests (authorization, origin, race of five admins, rollback, throttles, the reset
      getting the person back in, other accounts untouched, the email claimed for the right address
      and language), 245 in the staff app
- [x] **Smoke test** `admin-support.smoke.ts` (2): lookup, the field's error, the removal with its
      confirmation, the person signed out and their old password refused, the email, the log, own
      account, Greek at 320 px, JS budget; `/users` in the signed-out redirects
- [x] **Reviews**: security (no high; M1 password revoked, L1-L4 fixed: verifications, invisible
      characters, ticket-only note, audited views), performance (no high; `for no key update`),
      accessibility (the refusal's reason and focus survive the refresh, the field carries "not found",
      required), i18n (the email's button, gendered Greek, role labels, endonyms, 24-hour clock, Greek
      marked), test (order-dependent audit-filter test fixed, bystander, throttle, claim, standing)
- [ ] **Open**: a native speaker on the new Greek (the admin catalog's `Admin.users`, `Admin.user`,
      `AdminLookup`, `AdminUser`, the email in `packages/email/src/account-emails.ts`); a manual
      NVDA/VoiceOver pass over the removal; a per-day cap on removals (needs a second throttler); a
      support address for the email ("contact support" names none); `NOT VALID` constraints on the
      outbox after launch

#### 5.2c2 Moderation (2026-11-15, #78–#81)

- [x] **Implemented**: `POST /admin/listings/:id/suspend` (the owners' note, and whether to cancel the
      upcoming bookings: drivers refunded in full and told) and `…/reinstate`; `POST
/admin/users/:id/suspend` and `…/reinstate` (a note for the log only); `users.suspended_at`
      (migration 0040), refused at sign-in (Better Auth's session hook), by the API's guard and on the
      sign-in screens; four emails (two for owners, two for accounts); panels on the review and account
      pages in both languages; the owners read a suspension's note on their dashboard
- [x] **Unit and integration tests**: contracts, the four emails, the worker, the guard and the auth
      hook, the API integration tests (authorization, origin, bookings cancelled and refunds owed, the
      sweep staying quiet, sign-in refused, rollback, races, throttles), the staff app's panels, pages
      and nav
- [x] **Smoke test** `admin-moderation.smoke.ts` (3): a listing suspended with its bookings cancelled and
      brought back (what the owner reads, the emails, the log, Greek at 320 px), an account suspended and
      reinstated (sign-in refused with the message, a wrong password learns nothing, the emails)
- [x] **Reviews**: security (no high; the sign-in race closed by an `after` hook, the apps read a suspended
      session as signed out, the throttle's wording corrected), performance (bulk cancel set-based in
      chunks, the count only for a live listing), accessibility (buttons wrap at 320 px in Greek, a refusal
      that the page then catches up with keeps its reason and the focus, one alert at a time), i18n (the
      email goes to the primary owner and the screens say so, «επιστροφή χρημάτων», the lifted-suspension
      wording), test (a driver's cancel racing staff's, two-factor and reset roads, a manager as staff,
      the audit page, the allowlist, the kind coverage, the after hook)
- [ ] **Open**: a native speaker on the new Greek (`AdminModeration`, `AdminAccount`, the four emails,
      `AuthErrors.ACCOUNT_SUSPENDED`, `Owner.review.suspendedHeading`); a manual NVDA/VoiceOver pass over
      the two-step form and the refused-as-out-of-date focus; measure a bulk cancel on thousands of
      bookings; the retention of audit notes; a shared throttle across the destructive routes; the
      owner calendar and driver views of a staff-cancelled booking and the refund sweep for one are not
      tested end to end (the booking and its refund are)

#### 5.2c3 Bookings and payments (2026-11-16, #82–#85)

- [x] **Implemented**: `POST /admin/bookings/lookup` (a reference in a body, an id back), `GET
/admin/bookings/:id` (the booking with its driver, plate, money and disputes; opening it is logged),
      `POST /admin/bookings/:id/cancel` (full refund, driver and owners told), `…/refund/retry` and
      `…/refund/settle`, `GET /admin/payments` (lost disputes, open disputes, failed refunds), `POST
/admin/disputes/:id/decide` (who bears a lost dispute); migrations 0041–0043 (`refund_attempts`, the
      `settled` refund status, the dispute decision, audit actions, outbox kinds, two partial indexes);
      the worker sends a retried refund under a new key; the transfer sweep honours the decision; owners'
      earnings say a part will not be paid; three emails; `/bookings`, `/bookings/[id]`, `/payments` in
      the staff app in both languages
- [x] **Unit and integration tests**: contracts, the gateway's key, the worker, the emails, the earnings
      label, 50+ API integration tests (authorization, origin, who is refused, races of several admins and
      of a driver, rollback, throttles, retry then fail then retry, a payout already made, decided
      once, the hold released or kept, the owners' earnings), the staff app's panels, pages and audit
- [x] **Smoke test** `admin-money.smoke.ts` (3): a booking found and cancelled (note, question naming the
      refund, the owner's email, the log), a refund asked again then settled, a lost dispute decided each
      way (the lists, the owners' emails), Greek at 320 px, JS budget; the CSP check caught zod's `eval`
- [x] **Reviews and the gate** (2026-11-16): the five reviewers ran; what they found is fixed and tested:
      a disputed booking can't be cancelled or have its refund retried (`DISPUTED`, or the driver is paid
      twice); "the owners bear it" needs a payout still held (`NOT_HELD`, `payoutHeld`); a retried refund
      can be settled; a decided dispute is never reopened by a late Stripe event; money POSTs are
      `no-store` and the payments list is throttled; the dispute panel's ids, the h1 of an unavailable
      booking, wrapping Greek buttons, amounts as euros in the log, owners' emails reworded. The gate:
      `format:check`, `lint`, `typecheck`, `build`, `db:migrate` twice, `db:generate` (no changes),
      `api:generate` (stable), `pnpm test` (918 API, 351 staff app, 1119 web) and `test:smoke` (269 passed,
      4 skipped) all green. Smoke reads the audit log through its kind filter: the log is shared by every
      spec and shows 25 lines a page. One run of `booking.smoke.ts` found a missing `<title>` on a web page
      (axe `document-title`) and passed on rerun: watch for it

#### 5.2c4 Overstay reports (2026-11-17, #11, #76)

- [x] **Implemented**: `POST /owner/listings/:id/bookings/:bookingId/overstay` (whoever runs the listing, a stay
      that is over and within 14 days, once per booking), `GET /admin/overstays` (open or closed, oldest first),
      `GET /admin/overstays/:id`, `POST /admin/overstays/:id/resolve` (a note; never for a listing the admin runs
      or a report they made); migration 0046 (`overstay_reports`, `overstay.resolved` in the audit log's check);
      the owners' bookings list says if a report exists and offers one on a stay that is over; `/overstays` and
      `/overstays/[id]` in the staff app, both languages. Nothing is charged, refunded or emailed
- [x] **Unit and integration tests**: contracts, `overstays.integration.test.ts` (who may, which stays, the
      window's edges, races, note rules, the queue and its paging, closing, own listing, the table's
      constraints), the owner report component and list, the staff pages and panel
- [x] **Smoke test** `overstays.smoke.ts`: an owner reports (empty note, "not now", sent, reloaded, Greek at
      320 px), staff find it, read it, close it, the log, the owner's page says closed and never staff's note
- [x] **Reviews** (2026-11-17): security (no high; staff can't close their own report), performance (no
      high), accessibility (nothing serious: "Not now" while sending, required note, alert beside the buttons),
      i18n (one term, «αρχείο ενεργειών»; neutral "was reported"; caption by `select`), test (stale strings,
      the loaders, the audit label, the window's edge, the co-owner case, the shared security and sign-in
      specs). The gate: `format:check`, `lint`, `typecheck`, `build`, `db:migrate`, `db:generate` (no changes),
      `api:generate` (stable), `pnpm test` (all green) and `test:smoke` (279 passed, 4 skipped)
- [ ] **Open**: the Greek of this slice is unreviewed (a review form was sent to the product owner); manual
      NVDA/VoiceOver on the report form and the "Report sent" line; closed list newest first; a retention
      decision for the notes (Phase 6); `NOT VALID` for the audit check on a large `audit_log`

- [ ] **Left open on purpose** (in memory.md, none loses money): owners' "on its way" sums count a part
      marked `sending` whose dispute is then lost; the ledger check has no rule for `settled` refunds;
      deciding one of two disputes tells the owners as if the payout moved; native Greek review of the
      new strings; a manual NVDA/VoiceOver pass over the booking and payments pages

- [~] 2FA enrolment UI done (1.3); admin MFA enforced end to end once admin routes exist
  (sessions without a second factor are already ended when it is switched on)
- [~] Owner calendar and earnings done (5.1); a bookings list across listings is not
- [~] Admin approvals (listings, proof of the right to rent) and the audit log: done (5.2a, 5.2b).
  Moderation, users, bookings, payments: 5.2c
- [x] Overstay reports: the owner reports, support handles it (#11): done (5.2c4)
- [x] Support removes two-factor after an identity check: audited action, email to the address,
      written procedure (#13): done (5.2c1; the procedure is in GETTING_STARTED.md)

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
      second; a code change for now). The sender stops at SIGTERM (3.5), so the platform's usual
      30 s stop timeout is enough
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
