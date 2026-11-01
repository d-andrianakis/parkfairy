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

From plan §15 and the decisions form. Answered by the product owner on 2026-10-29 (#1–#2) and
2026-10-31 (#3–#17):

1. ~~Pooled capacity or separated?~~ **Named spaces**: every space is individually
   identified (`parking_spaces.label`) and bookings will reserve one specific space.
2. ~~Booking granularity; min/max duration?~~ **30-minute steps, 30 minutes to 30 days**
   (`BOOKING_STEP_MINUTES`, `MAX_BOOKING_DAYS` in contracts). Opening hours apply now: a
   listing must be open for the whole stay.
3. ~~Charge immediately or authorize/capture? Hold duration and late-payment policy.~~ **Charge
   in full at booking; a space is held for 10 minutes while the driver pays.** If a payment
   succeeds after the hold ran out (how we read "late payment"), the booking stands if the
   space is still free, otherwise the driver gets a full refund.
4. ~~Cancellation/refund policy; when owners become eligible for payout.~~ **Each owner picks
   from two or three set policies (#16); an owner can be paid 24 hours after the stay ends.**
5. ~~Owners: individuals, businesses, or both?~~ **Both from day one.** A listing goes live
   after a Stripe check, admin approval and proof of the right to rent.
6. ~~Exact Stripe Connect funds flow and Greek/EU compliance obligations.~~ **Separate charges
   and transfers**, so Parkfairy is ultimately liable for chargebacks. Parkfairy earns a
   commission from the owner's share (#15). An accountant and a lawyer confirm the legal and
   tax rules before Phase 4 starts (#18).
7. Stay across a clock change: **real elapsed time**, as pricing works today.
8. Booking without an account: **no, an account is required.**
9. Who picks the exact space: **the driver, from a list.** Two drivers can go for the same
   space, so the booking flow needs a "just taken" state.
10. Gap between bookings on one space: **the owner chooses none, 30 or 60 minutes.**
11. Overstays: **the owner reports it and support handles it.** No automatic charge at launch;
    the terms say what the driver owes and the next driver is refunded.
12. Price rules at launch, on top of the hourly rate and daily cap: **weekend rates, day and
    night rates, long-stay discounts, per-space prices and dated prices** (#17).
13. Two-factor recovery: **support removes it after an identity check**, as an audited admin
    action with an email to the address and a written procedure.
14. Personal data retention: **the adviser sets the periods** (#18).
15. ~~Commission rate.~~ **10% for now, and easy to change later.** So a stored setting rather
    than a constant in code, and each booking keeps the rate it was sold at, so a change never
    rewrites past bookings or payouts.
16. ~~Which cancellation policies owners choose from.~~ **All three:** full refund until 1 hour
    before the start; full refund until 24 hours before; full refund until 24 hours before and
    50% until the start. Whether the 14-day withdrawal right changes these is in #18.
17. ~~How price rules combine.~~ **For each half hour the most specific price wins: dated, then
    weekend, then day or night.** A long-stay discount and the daily caps never stack: the driver
    pays whichever total is lower. Where spaces in one listing cost different amounts, search
    shows "from" the cheapest free space, and the listing page shows each space's price.

Still open, both waiting on people outside the project:

18. For the accountant and lawyer, before Phase 4: VAT on parking and on commission; who issues
    the driver's receipt (myDATA); DAC7 seller reporting (the directive names parking spaces);
    whether the 14-day withdrawal right covers dated parking bookings (the Art. 16(l) exception
    covers leisure services, and we found no ruling on parking); retention periods; terms of
    service; whether Parkfairy may hold drivers' money until payout.
19. For Stripe, with the eligibility check in Phase 4: how long a platform may hold funds.
    Charging at booking, stays up to 365 days ahead (`MAX_START_AHEAD_DAYS`) and paying owners
    after the stay mean holding a driver's money for over a year. Stripe's docs give no limit
    for separate charges and transfers but advise against holding funds arbitrarily (checked
    2026-10-31). If this is a problem, the simple fix is a shorter booking horizon.

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
- **2026-10-29 · All UI is shadcn/ui** (product owner's rule). Components are the canonical
  registry source (`new-york-v4`) in `packages/ui/src/components/`. Usage-specific behaviour
  goes at the usage site (e.g. `FormField` drops `FieldError`'s `role="alert"`). The only
  edits to the copies are accessibility fixes every use needs, each marked `// Parkfairy:`
  so a diff against the registry explains itself (focus rings that reach 3:1, focus visible
  in forced-colors mode, readable invalid input text). shadcn monorepo layout: `components.json`
  in `packages/ui` and `apps/web`, and ui files import each other as `@parkfairy/ui/...`
  (package self-reference; works in tsc, Vitest and Turbopack).
- **2026-10-29 · Theme comes from a cookie, not a script.** `theme` cookie (`light`/`dark`;
  absent = system) → the root layout renders `<html class>`; "system" is pure CSS
  (`prefers-color-scheme`). No flash, works without JS, and nothing new for the nonce CSP.
  Not `next-themes`: it injects an inline script (needs the nonce plumbed through a client
  component) and needs `suppressHydrationWarning`. Pages render per request anyway; if some
  pages become static later, an explicit theme there needs a hashed inline script instead.
  The cookie lives 1 year: a consent-exempt "UI customisation" cookie under ePrivacy, but
  persistence beyond the session must be disclosed. It is listed for the cookie notice in
  progress.md (Phase 6 privacy review).

- **2026-10-29 · Public catalogue.** Published listings are `@Public()` reads
  (`/v1/parking/featured|search|:slug`); drafts and unknown slugs share one 404
  (`LISTING_NOT_FOUND`). Web pages are server components that call the API at `API_URL`
  (`lib/api.server.ts`, no cookies forwarded), never the database, so search, availability
  and pricing rules live in one place. Those calls forward the visitor's `X-Forwarded-For` (so
  the API rate-limits per visitor, as for the `/api` rewrite), time out after 4 s, and turn API
  failures into translated "unavailable" states. Featured listings are cached 5 min
  (`unstable_cache`, tag `featured-parking`: revalidate it when owners edit listings).
- **2026-10-29 · Rate limits in Redis.** The API's throttler (120/min per client) and Better
  Auth's limits keep their counters in Redis (atomic Lua scripts mirroring the in-memory
  stores), so they hold across instances; `REDIS_URL` is required for the API in
  production (web and API). If Redis fails: the API's general throttler lets requests
  through (failing closed would turn a Redis outage into an API outage), but Better Auth's
  limits fall back to a bounded per-process memory store, because they are the only
  brute-force control on passwords and two-factor codes and an attacker must not be able to
  switch them off by upsetting Redis. Better Auth keys contain the raw request path (counted
  before routing, attacker-sized), so they are sha256-hashed. The API's two keys share a hash
  tag (`throttle:{name:key}:hits|blocked`) for Redis Cluster. The web client never queues
  commands (its fallback is the memory store, so there is no free pass); the API client
  queues only until the first connection, then fails at once while Redis is away. Both drop
  a hung connection after 1 s without data (`socketTimeout`): a failover without a reset
  otherwise made every request wait the 500 ms command timeout for minutes. Failures are
  logged at most every 10 s.
  Integration tests count in memory, except `rate-limit.integration.test.ts` (Redis
  database 15, refuses to flush a remote or default database).
- **2026-10-29 · Worker shutdown** is checked by `pnpm --filter @parkfairy/worker
check:shutdown` in CI (Linux); Windows cannot deliver SIGTERM, so it skips locally.
- **2026-10-29 · Rate-limit keys need the proxy chain right.** Server-side calls and the
  `/api` rewrite both reach the API from the web server, so per-visitor limits depend on
  `X-Forwarded-For`. Next.js adds nothing to an existing header (it only fills a missing
  one), so the API's `TRUST_PROXY` must be the **web servers' addresses** (or "loopback"),
  never a count of the proxies in front of the web app: counting the web server as a hop
  trusts a visitor-chosen value. The first proxy must overwrite or append the header, and the
  web app's `TRUSTED_PROXIES` must list that proxy chain. Both are required in production
  so nobody ships the permissive defaults by accident; `TRUST_PROXY=true` is refused there
  (Express would take the visitor-written left-most entry), and `TRUSTED_PROXIES` entries
  must be IPs or CIDRs (Better Auth silently drops anything else, which trusts visitors
  again). `TRUSTED_PROXIES=none` makes Better Auth trust a single forwarded value, so it is
  safe only behind a platform that overwrites `X-Forwarded-For` with the client address,
  or locally. Locally everything shares 127.0.0.1.
- **2026-10-29 · Sessions are refreshed through the auth handler, not in server
  components.** Server components cannot set cookies, so a Better Auth refresh during an RSC
  render extended the session in the database but not the cookie, and users were signed out
  7 days after signing in however active. `getSession` passes `disableRefresh`; when the
  daily refresh is due (`lib/session-refresh.ts`), the layout renders `<SessionRefresh>`,
  which fetches `/api/auth/get-session`, whose response renews the cookie. The layout uses
  `getLayoutSession`: if the lookup fails, the page renders signed out instead of erroring.
- **2026-10-29 · Two-factor enrolment** lives on the account page (password again → QR +
  typed key → first code → backup codes shown once; turning it off asks for the password).
  Enabling, verifying and disabling each rotate the session cookie, so the smoke test uses
  its own account, never the shared one. Switching two-factor on or off also ends the user's
  other sessions (`hooks.after` in `packages/auth`): admin routes check the user's flag, so a
  session that never passed a second factor must not inherit it. Backup codes work at
  sign-in (`/two-factor`, "Use a backup code instead"), once each. After 10 wrong codes the
  account locks for 15 minutes (`TWO_FACTOR_LOCKOUT` in contracts configures Better Auth and
  the message). The steps load on intent, so the account page doesn't ship zod and the QR
  encoder until someone starts a change.
- **2026-10-30 · Account emails.** Sign-in needs a confirmed address, and the emailed link
  confirms without opening a session (`autoSignInAfterVerification` stays off): a stranger can
  sign up with someone's address, and clicking must not put its owner inside an account whose
  password the stranger knows. The link opens our page and a person presses a button, because
  mail scanners fetch links: pointed at Better Auth's GET, a scanner would confirm the stranger's
  account. Sending happens in the web process inside `after()`, not through
  BullMQ, because these jobs would hold live reset links in Redis, and the person who asked can
  simply ask again. Booking emails (Phase 3) need the outbox and worker instead, since nobody
  is there to ask again. `sendEmail` must return at once: Better Auth awaits its callbacks, so
  a slow send would reveal whether an address has an account. Links are rebuilt in
  `packages/auth` so a request's `callbackURL` never reaches an email. Emails leave out the
  account name, which is free text a stranger would get to put in front of the address's owner.
  Each recipient has a cap per kind of email (`RECIPIENT_LIMITS`, counted on the inbox, so
  `+tags` and Gmail dots don't multiply it), because Better Auth's limits are per client and
  every sign-up with a taken address mails its owner. Each kind also has a site budget per clock
  hour (`SITE_LIMITS`), separate so sign-up floods can't stop resets. Reset tokens are hashed at
  rest (`verification.storeIdentifier`), and a reset deletes the user's other verification rows:
  Better Auth consumes only the token used, so a thief's saved link would undo the recovery. The
  password-changed email links to the reset page. Resend is one `fetch` with an idempotency key
  and paced calls, no SDK. Unconfirmed accounts go after 7 days (longer than the link because
  signing in sends a new one). `users.locale` of an unconfirmed account is whatever the first
  sign-up chose, possibly a stranger; nothing better is known then.
- **2026-10-30, reversed 2026-10-31 · Sign up then sign in tells a taken address from a free
  one** (401 vs 403 `EMAIL_NOT_VERIFIED`). First accepted: it comes with requiring confirmation,
  rewriting the 403 leaves real people with no idea why they can't sign in, and it is noisy (a
  miss creates an account and emails the target). The product owner then wanted it fixed. Done:
  both cases get one answer (`AuthErrors.INVALID_EMAIL_OR_PASSWORD`), whose message also tells
  someone who just signed up to follow the emailed link; the right password still sends a new
  one.
- **2026-10-31 · A date and time are picked in one field, `DateTimeField`** (product owner's
  request). The server renders a native date input and time list, because search must work without
  JavaScript and before hydration. They then give way to one `role="combobox"` button in the same
  space, with hidden inputs carrying the same four fields, so URLs and validation don't change.
  Someone using a native field keeps it until focus leaves (not on a window switch), and whatever
  was entered is read from the DOM. Their Date and Time labels are `sr-only`: visible, the row
  would be taller than the button and the page would jump. The picker (54 KiB gzip) loads on hover,
  focus or press, and a press that can't load it brings the native fields back. Combobox, because
  a button can't carry `aria-invalid`. Days reach the calendar as noon UTC with `timeZone` set, so
  a visitor anywhere picks the Athens day; "today" is Athens' too.
- **2026-11-01 · A From picked at or past Until takes Until along** (product owner), keeping the
  length of the stay; only From does this, and without JavaScript the server's error still
  explains it. `StayFields` measures from the stay as it was when the picker first changed it, not
  from the previous step: a day, an hour and every arrow key each change From, so stepping would
  shorten the stay, and picking a later day then an earlier hour would lengthen it. That snapshot
  goes when the picker closes, so a moved Until doesn't jump back on the next visit. The screen
  reader hears about it once, from `onCloseAutoFocus`: sooner, the focus landing on the field cuts
  the message off. A stay with no length of its own (a refused URL) gets the default two hours.
  The message is screen-reader only on purpose. The accessibility review suggested a visible line
  (advisory, not an AA failure), but it would appear just after the press that closes the picker,
  moving Search or Until out from under the pointer mid-click. Sighted people see the field change,
  and the results page states the stay under its heading. Known limit: the length is on the wall
  clock, but `zonedTimeToUtc` moves a time in the spring gap forward, so on that one night a From
  of 03:00 or 03:30 with a stay of an hour or less is still refused, with the usual error.
- **2026-10-31 · Primary is darker in both themes** (product owner, on the design-system page,
  https://claude.ai/artifact/DStnsAF85ew2BoBz5PJ7mD): light `oklch(0.36 0.18 264.376)`, dark
  `oklch(0.62 0.17 257)`. `globals.css` stays the source of truth: an edit on that page does not
  reach the repo by itself. The dark value has less headroom: `primary-foreground` on it is 5.47:1
  (4.60:1 on hover), and primary text is 4.84:1 on `card` but only 3.97:1 on `muted` and
  `secondary`. No screen does that today, so keep primary text off those fills in dark mode, or
  add the pair to `tokens.test.ts` and lighten the token. Emails use the light primary too, as
  the fixed `#092c99` in `lib/email/render.ts` (product owner, 2026-11-01): mail clients can't read
  the CSS, so `tokens.test.ts` fails when `--primary` moves away from that value.
- **2026-10-31 · Whatever Postgres changes on the way in is an enumeration leak.** A lone surrogate
  in a name passed `\p{Cc}`, and `pg` rewrites it to U+FFFD, so a free address echoed a changed name
  while a taken one echoed the raw text: one request told them apart, with no timing involved.
  `SignUpInputSchema` now refuses `\p{Cs}` too (with the `u` flag that means unpaired surrogates
  only, so emoji stay). `validateSignUp` also requires the parsed name to equal the raw one: only
  the parsed copy is trimmed and the raw one is stored, so padding got past the length limit.
- **2026-10-31 · Leave `transaction` unset on the Drizzle adapter.** Better Auth runs sign-up inside
  `runWithTransaction`, a no-op only while that option is off. On, it would hold one of the web
  app's few connections through scrypt and the Redis address claim, per sign-up.
- **2026-10-31 · A free address and a taken one must look alike everywhere.** The review of that
  fix found the same leak three more ways, so all are closed in `packages/auth`: two sign-ups at
  once (the loser hit the unique index: 422 for a free address only, every time, no timing
  needed), so `create.before` claims the address in the rate-limit store and a lost claim
  throws 403, which Better Auth answers as a duplicate; sign-up and sign-in timing, covered with
  reset by `ANSWER_FLOOR_MS` (a floor hides nothing below it, so measure real work again on
  production hardware); and `createdAt`/`updatedAt` differing in about 1% of real answers. With
  Redis down the claim holds per instance. Any new user field or failure after the lookup must
  keep this true.
- **2026-10-31 · A visitor gets a share of an address's reset emails** (`VISITOR_SHARE`, 3 of 6
  an hour), or one person spends the allowance in two minutes and the owner's request sends
  nothing. Checked before the recipient cap, so what it drops spends nothing. The IP comes from
  Better Auth's `getIP`, so forged headers get as far as they do with the rate limits; when it
  can't be told, visitors share `unknown`. Accepted: two real IPs can still spend the allowance,
  but the emails they trigger reach the owner, whose links work. Data: a hash of address and IP
  in Redis for an hour, for abuse control only.
- **2026-10-31 · "Check your inbox" survives a language switch and a reload** (`useSentPanel`).
  `?sent=1` marks the state, because the title comes from the server and the switcher carries
  URL state. The address is in `sessionStorage`, per page, never the URL; it goes on the plain
  form, on sign-in and on sign-out. The URL changes through `history.replaceState`: a navigation
  would refetch and move focus, so `keepFocusThroughUrlChange` tells `RouteFocus` this one isn't.
  A link back to the plain page doesn't remount either: the hook resets itself and calls
  `router.refresh()` to get the title back. `?sent=1` with no stored address goes to the form.
  Accepted: that redirect needs JavaScript, so a copied link without it stays on the heading.
- **2026-10-31 · Password fields are `PasswordField`, with `usePasswordReveal` in the form.** The
  form calls `reveal.hide()` once validation has passed, not on the `submit` event: someone told
  their password is too short needs to go on seeing it. Hiding matters because browsers keep text
  fields in autofill history and password managers only save password fields. The button
  renders after hydration; until then `endControl` is `null`, not `undefined`, because a
  different tree around the input makes React replace it, losing focus and keystrokes on a real
  page while no test render notices. Hence the `hydrateRoot` test.
- **2026-10-30 · Sign-up is validated before the address is looked up** (`validateSignUp`,
  `hooks.before`). Only a new account reaches the insert, so anything that fails there is an
  oracle: `locale: "xx"` and a NUL in the name both did. Any new sign-up field goes through it.
- **2026-10-30 · Emails become files only on this machine.** Without `RESEND_API_KEY` they go
  to `.emails/`, and `parseServerEnv` allows that only when `BETTER_AUTH_URL` is loopback. The
  check is on the origin, not `NODE_ENV`, because smoke runs production builds locally while
  staging must never write live reset links to disk. The transport has only run against a mock
  so far: try one real send when a Resend key and verified domain exist.
- **2026-10-30 · The root error screen carries its own strings.** `app/global-error.tsx`
  shows when the root layout failed, often because a chunk could not load, so it can neither
  use the message provider nor fetch a catalog. `messages/error-fallback.ts` holds the
  `Error` namespace of each catalog; a test fails if it drifts from the catalogs.
- **2026-10-29 · Search.** Location is a curated area (`AREAS` in contracts, names in the
  `Areas` catalog) or the browser position rounded to ~100 m; PostGIS `ST_DWithin` 5 km on a
  `geography` column with a GiST index, nearest first. Opening hours are weekly wall-clock
  periods `[opens, closes)` in minutes, in the listing's IANA zone, with an exclusion
  constraint against overlaps; the API checks the stay day by day on the wall clock. Free
  spaces = active spaces until bookings exist (Phase 3 subtracts overlapping ones). Search
  reads nearest-first candidates (`<->` KNN on the GiST index) in batches of 100 and filters
  opening hours per batch, so open listings behind closed ones are still found; at scale,
  move the hours check into SQL (e.g. a minute-of-week multirange column).
- **2026-10-29 · Stay rules.** Start at most 365 days ahead (`MAX_START_AHEAD_DAYS`, which
  also keeps every date the API walks below year 10000: a year-9999 window once looped the
  API forever). The 30-day limit is measured on the Athens wall clock (a 30-day stay across
  the October change is 30 days + 1 h of real time); prices use elapsed time (a Sat→Sun day
  across that change costs a capped day plus one hour).
- **2026-10-29 · Header from the server.** The layout reads the session (`getSession`, cached
  per request) and renders the account links, so no client session fetch, no layout shift,
  and no Better Auth client on pages without auth forms (the language switcher imports it
  only when a signed-in user switches). Client components get only their catalog
  namespaces via `ClientMessages` (it replaces, not merges: list every namespace a
  subtree's client components use).
- **2026-10-29 · Pricing.** Hourly rate pro rata per half hour, rounded up to the cent; each
  full 24 h and the remainder capped at the optional daily maximum (`pricing.ts`, server-side
  only). Integer minor units throughout.
- **2026-10-29 · Listing text is not translated.** Name, address and description are in the
  owner's language (`content_locale`) and marked up with `lang`, so screen readers switch voice.
- **2026-10-29 · Demo data.** `pnpm db:seed` loads 14 fictional listings and the demo account
  (credentials in GETTING_STARTED.md). It refuses non-local databases and production because
  the password is public: the URL must name this machine (no `?host=`/`?hostaddr=`
  overrides, which node-postgres honours) and the database must carry the marker
  `parkfairy.environment = local` (set by `pnpm db:up` and the init script; CI sets it too),
  which a tunnel cannot fake. Dev Postgres/Redis listen on 127.0.0.1 only. CI seeds before
  the smoke suite; shared environments opt in to the catalogue smoke tests with
  `SMOKE_DEMO_DATA=true`.
- **2026-10-29 · Listing integrity in the database.** Slug format and length, time zone
  (Europe/Athens only until the web app formats per listing zone), and text lengths are
  CHECK constraints (migration 0005); an invalid zone would make `Intl` throw and break
  search for a whole area.

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
  comes from the layout (pages render content only). Forms keep the submit button focusable
  while submitting (`aria-disabled` + ignore repeats, never `disabled`) and announce failed
  submits with `useInvalidSubmitStatus`. `RouteFocus` moves focus to main after client-side
  navigation.
- **Colour:** use the theme tokens (`bg-primary`, `text-muted-foreground`, `bg-status-limited`
  with `text-status-limited-foreground`, …), not raw palette classes, so both themes work.
  Status colours are fills with a paired foreground and never the only signal (add an icon
  or text). Every token pair is contrast-tested in `packages/ui/src/styles/tokens.test.ts`;
  add pairs there when a component combines tokens in a new way.
- **Adding a shadcn component:** from `apps/web`, `pnpm dlx shadcn@<exact version> add <name>`
  (it writes into `packages/ui`). Then: dark values the CLI writes into a `.dark {}` block
  belong in `@utility theme-dark-tokens` in `globals.css` (the token test fails if a light
  token has no dark counterpart), add contrast pairs, run Prettier/ESLint, and check the JS
  budget for anything client-side. Built-in English text (Dialog/Sheet "Close", Pagination
  "Previous") fails `i18next/no-literal-string`, which also covers `packages/ui`: turn it
  into a required prop the app fills from its catalogs. Watch for `line-clamp-*` (e.g.
  `AlertTitle`) truncating longer Greek text, and for overlays that need lazy loading (see
  `theme-toggle.tsx`) to stay within the JS budget.
- **Field errors:** never pass `errors` to `FieldError`. Zod messages here are
  `VALIDATION_MESSAGES` keys, so shadcn's documented `errors={[fieldState.error]}` would show
  raw keys. Use `FormField` (translates via `useValidationMessage()` and passes children).
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
- **Better Auth rate limits** sign-in/sign-up (and every `/two-factor/*` path) at 3
  requests / 10 s per IP and path, and reset and confirmation requests at 3 / 60 s. Smoke specs
  that sign in use `test.use(ownVisitor)`: each test sends its own `X-Forwarded-For`, which the
  local web app trusts as a single value (`TRUSTED_PROXIES=none`). That models separate
  visitors and leaves the limits untouched. One test still has only 3 sign-ins in 10 s.
  Counters live in Redis when `REDIS_URL` is set (see the rate-limits decision).
- **Better Auth enumeration protection needs `customSyntheticUser`.** With verification on,
  sign-up with a taken address answers with a fake user, but it lacks additional and plugin
  fields (`role`, `locale`, `twoFactorEnabled`) unless told, and the shape then gives the
  account away. A new user field must be added there too; the integration test compares keys.
- **A two-factor sign-in clears the session cookie with an empty `session_token=`.** Checking
  that a response "set no session" must look for a value, not the cookie name.
- **`next dev` keeps the Better Auth instance across hot reloads** (`globalForAuth`), so changes
  to its options need a server restart.
- **Running the smoke suite beside `pnpm dev`:** `pnpm test:smoke` reuses servers on 3000/4000/
  4100, which would test dev builds. Build web with `API_URL=http://localhost:4200` (Next bakes
  rewrites into the build), start the built apps on other ports with `BETTER_AUTH_URL`,
  `TRUSTED_ORIGINS`, `API_PORT` and `WORKER_HEALTH_PORT` set, then point the suite at them with
  `SMOKE_WEB_URL`, `SMOKE_API_URL`, `SMOKE_WORKER_URL`, `SMOKE_DEMO_DATA=true` and
  `EMAIL_OUTBOX_DIR`. Rebuild web afterwards.
- **Everything local arrives from 127.0.0.1,** so the smoke suite would share one client's
  limits (120/min per route on the API) and a re-run would meet the last run's counters. Each
  worker therefore sends its own `X-Forwarded-For` (`VISITOR_HEADERS`).
- **The rate-limit stores use a rolling window that only ends after a quiet `window`:** every
  allowed hit moves it forward. Right for "5 an hour for one address". Wrong for a site-wide
  budget, which fills under steady traffic and stays shut: put the clock hour in the key.
- **API integration tests run with `NODE_ENV=test`, where Better Auth skips origin checks and
  rate limits.** Off-site redirects, CSRF and limits on auth routes can only be tested in the
  smoke suite (`security.smoke.ts`).
- **A failed `register()` in `instrumentation.ts` does not stop Next:** it logs and serves on.
  `requireServerEnv` exits the process itself. `process.env` already holds the root `.env` by
  then, because `next.config.ts` loads it. Don't import `server-only` from what `register()`
  loads.
- **`router.refresh()` puts the server's `<title>` back,** overwriting `document.title`. A state
  that outlives a refresh needs its own URL (`/reset-password?done=1`).
- **Zod's JIT probe runs when a schema is built**, not when it parses: `z.config({ jitless:
true })` (`lib/zod-jitless.ts`) must be the first import of every client component that
  uses zod, ahead of `@parkfairy/contracts`, or the CSP reports `script-src eval`.
- **`vi.resetModules()` does not reset `vi.mock` factories**: the mocked module keeps its
  first instance while a direct import of the mock file gets a new one. Take helpers from the
  mocked path (`await import('@/i18n/navigation')`), as `route-focus.test.tsx` does.
- **Client components get only their subtree's catalog namespaces** (`ClientMessages`). The
  lists live in `i18n/client-namespaces.ts`, and component tests render with the same list
  (`rendererFor(CLIENT_NAMESPACES.x)`), so a missing namespace fails a test instead of
  showing raw keys.
- **Better Auth client IP** comes from `x-forwarded-for` and is trusted only as a single IP
  unless `advanced.ipAddress.trustedProxies` is set (`TRUSTED_PROXIES` env). Configure it
  for the real proxy chain before launch, otherwise rate limiting can be bypassed or disabled.
- **Vitest runs a function returned from `beforeEach` as a cleanup hook.** So
  `beforeEach(() => mock.mockReset())` calls the mock after every test (and hangs if it
  returns a pending promise). Use braces.
- **ioredis with `enableOfflineQueue: false`** fails every command until connected, so the
  first requests after start-up skipped rate limiting. Use the offline queue with a short
  `commandTimeout` instead.
- **Zod JIT vs CSP:** Zod 4 probes `new Function`; the browser blocks it and reports a CSP
  violation. `lib/zod-jitless.ts` sets `z.config({ jitless: true })`; see the import-order
  note above.
- **Next 16 dev writes `apps/web/AGENTS.md`** pointing agents at `node_modules/next/dist/docs`.
  Keep it committed (it is re-created otherwise). Those docs are the authority for Next 16
  APIs, which differ from older training data (`proxy.ts` replaces `middleware.ts`).
- **Known advisory (2026-10-28):** `pnpm audit` reports a _moderate_ esbuild dev-server issue
  (GHSA-67mh-4wv8-2f99) via drizzle-kit's deprecated `@esbuild-kit` loader. Dev-time only, and
  we never run esbuild's dev server, so it's not exploitable here. CI fails on high/critical only.
- **TypeScript is pinned to 6.0.x:** typescript-eslint and @nestjs/swagger don't support
  TS 7 yet. **ESLint is pinned to 9.x:** eslint-config-next pulls eslint-plugin-import,
  which doesn't support ESLint 10.
- **Playwright MCP (2026-10-28):** `.mcp.json` runs `@playwright/mcp` (an exact-pinned root
  devDependency) with `node node_modules/@playwright/mcp/cli.js`, not `npx`. On native
  Windows, `npx` needs a `cmd /c` wrapper, and that wrapper breaks the config on macOS and
  Linux. The lockfile also pins the version, so nothing is fetched at launch. The browser is
  isolated (fresh profile each session) and limited to the local origins with
  `--allowed-origins`. That stops stray navigation to real sites, but it is not a security
  boundary and it doesn't apply to redirects. The app's CSP allows only `'self'`, so adding
  an external origin there also means updating that list. `--no-webmcp` stops pages, which
  during XSS testing can include injected scripts, from registering tools with the agent.
  When a Playwright MCP tool takes a `filename`, put the file under `.playwright-mcp/`.
  Explicit filenames resolve against the repo root, which git does not ignore, so a network
  dump of the sign-in request saved there would put credentials in reach of `git add`.
  `browser_run_code_unsafe` is in the core tool set and can't be turned off from
  `.mcp.json`. It runs code in the server's Node process, past the origin and file limits.
  We chose to keep it but approve each call by hand. Never allow-list it.

- **A Better Auth after hook can't change a status by throwing.** The error replaces the body,
  but `dispatch` passes the original `status` on, so a rewritten 403 stays a 403 with the new
  body. Return a `Response` instead, only when `ctx.request` exists: a server-side `auth.api`
  call would otherwise resolve with that Response where it expects the error.
- **`getByLabel('Password')` also matches the "Show password" button** in Playwright (it matches
  substrings and `aria-label`). Use `{ exact: true }`. Testing Library's string match is exact.
- **Reset requests can't reach `VISITOR_SHARE` in the smoke suite:** Better Auth refuses the
  fourth request a minute first. The share is covered by unit tests only.
- **`shadcn add` (4.23.0) needs care here.** It stops to ask about overwriting `button.tsx` (never
  yes: our fixes are in it), so whatever comes after is not written; it adds shadcn's `cn` package
  to `apps/web`, and files import `cn` from it instead of `@parkfairy/ui/lib/utils`. Calendar and
  toggle-group were taken from `shadcn view <name>` instead, imports rewritten, with dependencies
  pinned in `packages/ui`.
- **`outline-none` also sets Tailwind's outline-style variable,** so `outline-2` on top of it draws
  nothing. Add `outline-solid`; shadcn's base classes all have `outline-none`.
- **react-day-picker:** it sets `lang="en-US"` and English labels unless given `lang` and `labels`,
  and dropping `labelDayButton` loses ", selected", which only the cell's `aria-selected` then
  carries. Its `TZDate` reads the real clock whatever `vi.useFakeTimers` says, and a date that is
  today gets another name, so tests use far-future dates. The registry's inline `components`
  remount the whole calendar on every parent render; they are module constants here. Its month
  caption is a `role="status"` of its own, so tests look for ours inside the form.
- **`document.hasFocus()` is false in jsdom.** Mock it where code depends on it.
- **Axe right after `emulateMedia` can catch a colour mid-transition:** a toggle fades its text
  while its fill changes at once. Await `document.getAnimations()` first.
- **shadcn focus ring is `ring-ring/50`.** At half opacity only a very dark ring reaches 3:1
  on white, hence the navy `--ring` in the light theme. Field borders (`--input`) are slate-500
  for the same reason (shadcn's default is ~1.2:1). The token test guards both.
- **Radix menus: use `modal={false}`.** A modal DropdownMenu sets `aria-hidden` on the page
  while its links stay focusable (axe `aria-hidden-focus`). jsdom axe does not catch this;
  only the smoke suite does. In Playwright, assert the focused item after an arrow key before
  pressing Enter: Radix moves focus asynchronously. Menus don't wrap at the ends (`loop` off).
- **Out-of-gamut colours.** Tailwind's saturated colours (red-600, blue-700, …) lie just
  outside sRGB; Chrome draws the `lab()` value and the build adds its own hex fallback, so
  contrast differs slightly from a plain conversion. red-600 at 90% (the destructive Alert)
  computed 4.52:1 yet failed axe; light `--destructive` is red-700 now. The token test adds
  a 0.15 margin to any pair with an out-of-gamut colour.
- **user-event and swapped elements.** `user.click(el)` keeps dispatching to `el` even after
  React replaces it mid-click (browsers target what is under the pointer). Test lazy-swap
  paths with synchronous `fireEvent` for the early press.
- **drizzle-kit quotes custom column types** with parentheses: it generated
  `"location" "geography(Point,4326)"`, which Postgres reads as a type name. Unquote it in the
  generated SQL before the migration is applied anywhere (done in 0003).
- **Zod 4 object refinements run even after a field failed** its own check (e.g. a bad
  `z.iso.datetime()`), so `superRefine` must guard against unparsable values (NaN dates).
- **Greek times are 12-hour by default** in CLDR/Intl (`9:00 π.μ.`). Decision (2026-10-29):
  Greek uses the 24-hour clock everywhere (`i18n/formats.ts`: `h23`, and `h24` for a
  closing time of midnight, "24:00"), as Greek timetables and shop hours do.
- **`role={undefined}` does not cross the server→client boundary.** Passing it from a server
  component to a `'use client'` component (shadcn Field, FieldError) is dropped, and the
  defaults come back (`role="group"`, `role="alert"`). jsdom tests never see this. Use the
  client wrappers in `components/plain-field.tsx`.
- **React `cache()` compares arguments by identity:** pass primitives (slug, start, end),
  not objects, or `generateMetadata` and the page make two API calls.
- **The generated API client ignores Next's `fetch` options** (`next: { revalidate }` is
  dropped on the `Request`); cache with `unstable_cache` instead.
- **Playwright `getByLabel` misses names built from several `aria-labelledby` ids**
  ("From Date"); use `getByRole(..., { name })`.
- **Next 16 error boundaries get `retry()`** (re-fetches), not just `reset()`.
- **Docker Desktop on this machine stops now and then** (the engine pipe disappears). If
  tests fail at start-up or `docker ps` cannot connect, start Docker Desktop and run
  `pnpm db:up`.
- **Search URLs carry Athens wall-clock fields** (`startDate`, `startTime`, `endDate`,
  `endTime`), converted with `zonedTimeToUtc` (DST-safe: gap times move forward, repeated times
  take the earlier instant). Athens offsets are whole hours, so half-hour alignment can be
  checked on UTC instants.
- **Stopping a backgrounded `next start` on Windows** leaves the node process listening on
  :3000 (the smoke suite then reuses that stale build). Kill it by port before re-running.

## Performance baselines

- 2026-10-28: first-visit JS (compressed) `/en` 218 KiB, `/en/sign-in` 233 KiB. Budget in
  `tests/smoke/specs/performance.smoke.ts` is 250 KiB; raise only with a reason here.
- 2026-10-29: `/en` 219 KiB, `/en/sign-in` 236 KiB; phone CLS 0 (`performance.smoke.ts`).
  The shadcn theme menu costs ~28 KiB gzip (Radix menu + floating-ui + focus scope +
  dismissable layer + remove-scroll), so it is **loaded on intent**: a stand-in button is
  rendered, hover/focus/tap imports `theme-menu.tsx`, and an early press is replayed through
  Radix's own trigger handlers. Eagerly it measured 248 / 264 KiB. Do the same for other
  rarely used overlays in the layout; overlays a page needs at once belong to that page's
  chunk, not the root layout.
- 2026-10-29 (public catalogue, after review fixes): `/en` 212 KiB, `/en/search` 212 KiB,
  listing page 210 KiB, `/en/sign-in` 239 KiB (auth forms need Better Auth); phone CLS 0 on
  all four.
- 2026-10-29 (second review round): `/en` 169 KiB, `/en/search` 169 KiB, listing 167 KiB,
  `/en/sign-in` 228 KiB. The root layout had been shipping zod + every contract schema
  (34 KiB, via the contracts barrel in `i18n/routing.ts`) and React Query + the API client
  (9 KiB) to every page. Now: `@parkfairy/contracts/locales` is a zod-free subpath, the
  contracts package is `sideEffects: false`, and the query provider wraps only the account
  page. Keep client components on the catalogue free of `@parkfairy/contracts` (barrel) and
  `lib/search.ts` imports. API catalogue reads: search and listing medians ~35 ms locally
  (budget 300 ms in `performance.smoke.ts`).
- 2026-10-30: `/en/account` 196 KiB (two-factor steps load on intent; ~247 KiB if eager),
  CLS 0 on a phone while the API identity loads (its layout renders before the data).
- 2026-10-30 (account emails): every auth page ~228 KiB (measured before the last edits; the
  smoke budget of 250 KiB passes on the final build). `lib/auth.ts` is in every page's server
  bundle, so the email code and both catalogs added 4–5% eager server JS (no cold-start change
  measured).
- 2026-10-31 (decisions follow-ups, measured before the review fixes; the budget passes on the
  final build): `/en` 169 KiB, auth pages 228–229 KiB (`/en/sign-up` largest), `/en/account` 195
  KiB, 248.5 KiB once the two-factor steps load on intent, so they must stay lazy. The answer
  floors pin no database connection: reset held 200 requests a second without errors. Each
  held request is a socket and a timer, which only costs money on per-invocation hosting.
  CLS on a direct `?sent=1` load was 0.014–0.023 before `SentPlaceholder` reserved the height
  (budget 0.01). Since 2026-10-31 `performance.smoke.ts` holds all three pages to that budget, in
  both languages.
- 2026-10-31 (date and time picker, from the build manifests before the review fixes; the budget
  passes on the final build): `/en` and `/en/search` 170.4 KiB, 224 KiB once the picker loads.

## Translation notes

- Greek copy was written by the developer tooling, not a native translator. Have a native
  speaker review `apps/web/messages/el.json` before launch (tracked in progress.md).
- **2026-10-31 · Wording settled by the product owner.** New copy follows these: `Παροχές` for
  listing features; `άφιξη`/`αναχώρηση` for the start and end of a stay; `Εμφάνιση` for the theme
  menu and `Προεπιλογή` for its system option; `Επιβεβαίωση` for an address (two-factor keeps
  `Επαλήθευση`); `Επαναφορά κωδικού πρόσβασης` for titles and buttons alike; "Αν υπάρχει
  λογαριασμός…, θα λάβετε σύνδεσμο"; `Ζητήθηκε επαναφορά…` in the reset email. Kept as they were:
  `Ανοιχτά`, `online κράτηση`, the area names, `στη διεύθυνση {email}`, "Ακολουθήστε τον
  σύνδεσμο", `Αποστολή ξανά`, `στάλθηκε`, `πια`, `περιηγητή`, `Πίσω στη σύνδεση`.
- **2026-10-31 · Second round of wording.** The sign-in error ends `που λάβατε`; the
  existing-account email opens `Έγινε προσπάθεια…`; the page where a new password is typed has
  the tab title `Νέος κωδικός πρόσβασης`, while its heading stays Επαναφορά. Deliberately kept,
  so don't "fix" them: `σας στείλαμε` in `VerifyEmail.sentBody`, neuter `Ανοιχτόχρωμο` and
  `Σκουρόχρωμο`, `Εμφάνιση κωδικού πρόσβασης`, the verb "να ορίσετε" inside sentences, `πλέον` in
  `ResetPassword.doneBody`, `Αποθήκευση νέου κωδικού πρόσβασης` in `ResetPassword.submit` (decided
  2026-11-01: it says what the press does and leads into `Αποθήκευση…`), and the `Από`/`Έως`
  labels. English errors say arrival and departure
  and the reset email is impersonal, but "Choose a new password", "we’ve sent it a link" and the
  existing-account "Someone tried…" stay.
- Language names are always shown in their own language (`LOCALE_ENDONYMS`).
