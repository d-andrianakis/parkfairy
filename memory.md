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

Answered by the product owner on 2026-11-02, for owner onboarding:

20. Where the owner journey ends for now: **at submitted.** No admin screen until Phase 5; staff change
    a listing's status by hand in the database. The owner side still handles `changes_requested`
    (note shown, fix, resubmit), because status emails were asked for too.
21. How an owner places a facility: **Mapbox now**: address search and a draggable pin, with typed
    coordinates and "use my location" alongside (WCAG 2.5.7 rules out drag-only input).
22. Tax details: **collected now**, encrypted, on the fields DAC7 names, and adjusted when the adviser
    answers #18. Payout account details wait for Stripe in Phase 4.
23. Also in this round: **the full price rules (#17), status emails and one reminder email.**

Answered by the product owner on 2026-11-03, for closures and special hours:

24. Who can change them, and when: **the owner, at any status, with no new review.** They only change
    when drivers can come; nothing staff checked changes, and a live listing needs them most.
25. What one entry says: **a date range, either closed all day or open one set of hours each day.**
    It replaces the weekly hours for those days, midnight to midnight.
26. What drivers see: **upcoming dates and hours on the listing page, never the owner's note.** Text
    changed on a live listing skips review, so none of it goes public.
27. Closing days that already have bookings (Phase 3): **refused until the owner cancels those
    bookings**, each driver fully refunded, so nobody arrives at a closed gate.
28. Closed hours inside a day, asked for the same day: **both** a break in the weekly hours (per
    weekday, e.g. closed 14:00–17:00) and, on a dated entry, "closed from … to …" with the weekly
    hours around it.
29. Several listings: **the owner chooses which of their listings get a listing's closures, all of
    them included.** Built as copying: the entries are added to each chosen listing.

Answered by the product owner on 2026-11-04:

30. Weekly hours can be copied too: **to the owner's drafts and listings sent back only**, since a
    listing with staff or live has hours staff have checked. The copy replaces the target's week.
31. The listing page keeps showing **every upcoming closure**, after the security review pointed out
    that a private owner's closed dates may say when their home is empty. #26 stands as it was.
32. The spring-forward night's 03:00 and 03:30 arrivals stay on offer, refused with the usual error
    for a short stay (1.16): one night a year, and the error explains it.

Answered by the product owner on 2026-11-08, for booking (Phase 3):

33. Before payments exist, a hold becomes a booking through **a stand-in Confirm that charges
    nothing, on a local run only** (`bookingWithoutPayment`: `BETTER_AUTH_URL` is loopback, as for
    files instead of S3). Elsewhere the API refuses holds (`BOOKING_UNAVAILABLE`) and the listing
    page still says booking is coming (`ParkingListingDetail.bookingOpen`). Phase 4 swaps the
    press for Stripe.
34. Owners cancel bookings **on a bookings page per listing** (`/owner/listings/:id/bookings`); the
    refusal on the closures and hours pages links there. Calendar and earnings stay in Phase 5.
35. The owner sees **the driver's account name and number plate**. The plate is asked for when
    confirming; it is personal data, on the Phase 6 retention list.
36. Booking emails: **all four**: to the driver when confirmed and when cancelled (by either side),
    to the owner for a new booking and when a driver cancels.

Answered by the product owner on 2026-11-08, after the reviews:

37. Confirming works **only while the 10-minute hold runs.** After it the driver chooses the space
    again. Since running over now costs the hold, the time limit must be adjustable (WCAG 2.2.1): the
    booking page offers "Keep it for 10 more minutes" (`POST /bookings/:id/extend`, from now, at most
    `HOLD_MAX_EXTENSIONS` = 10 times) and warns two minutes before the end, without moving the
    focus. One hold per driver still holds, so keeping one ties up one space at most. Decision #3's
    late payment is Phase 4's, settled where the payment arrives, not by the driver's press.
38. A stay **already under way can't be cancelled by the owner;** support handles it. So closing the
    rest of today over a driver already parked is refused, and nobody's car is shut in.
39. Owners see the driver's name and plate **from the moment of booking**, not only near arrival.
    How long they stay is the Phase 6 retention review's.

Answered by the product owner on 2026-11-09, for the rest of Phase 3:

40. Drivers search by address with **suggestions while typing** (Mapbox Search Box). Built through our
    API rather than from the browser, so the token stays on the server, the search page's CSP needs
    nothing for it, and every billed call sits behind our limits. Text that was never picked from the
    list (or typed without JavaScript) is looked up once by the server, which redirects to its
    coordinates.
41. Search results get **a map on request** ("Show the map"), with Mapbox allowed on the search page
    only. Pins are numbered as the list is.
42. Built **without a Mapbox token**: unit tests mock Mapbox, the smoke suite covers the page with no
    token (no address field, no map, everything else working). The first real run waits for a token.
43. The 3.1 leftovers in the same round: the sign-up link keeping `?next=`, the missing tests, the
    accessibility advisories, per-account hold limits (L2), a cap on booking emails to one owner (L3)
    and **the listing's name and address copied onto each booking** (L6), so text changed on a
    listing sent back never reaches drivers unreviewed.

Answered by the product owner on 2026-11-10, after the reviews:

44. The owner-email cap (L3) **stays as built**: a driver who books and cancels three times in a day
    uses it up, and their next real booking then shows on the owner's page without an email. A rare
    abuse case, and the driver still gets all of theirs.
45. The results map gets **"Show all results" and cooperative gestures**: one press refits every pin
    (a way back without dragging; the list stays the equivalent), and on touch one finger scrolls the
    page while two move the map, with the hints in both languages.

Our readings (2026-11-08), not asked; change any that are wrong:

- **One hold per driver.** A new hold lets the driver's earlier ones go, so one account can't sit
  on many spaces; pressing Book twice takes the same space again. Holds are 10 a minute per visitor.
  The release before the insert can't see a press made at the same instant, so a partial unique
  index (`bookings_one_hold_per_user_idx`, 0016) refuses the second and the service retries it,
  which then lets the first go (the race test runs three drivers' pairs at once).
- **A cancel never gives back less than the driver was shown:** the page sends the refund it
  quoted, and if the start has come nearer and less comes back now, the API refuses
  (`REFUND_CHANGED`, with the new amount) and the question asks again with it.
- **A driver cancels until arrival**, refunded by the policy stored on the booking. "Until 24 hours
  before" includes the 24th hour; half of an odd amount rounds up, for the driver. Under way, it's
  support's (Phase 5). **The owner cancels only before arrival** (#38), always in full.
- **No changes to a booking:** cancel and book again. **Owners can't book their own listings**
  (`OWN_LISTING`): it would be a payout to oneself in Phase 4.
- **Plates are read as the car shows them:** Greek capitals that look Latin become Latin
  (ΙΚΒ-1234 = IKB1234), accents, spaces, dots and hyphens go, 2–10 letters and digits remain.
- **The price is the one quoted at the hold,** however often it is kept longer.
- **The gap is stored on each booking**, so an owner raising it changes only later bookings.
- A listing with no cancellation policy (none that was sent in) books under `oneHour`, the most
  generous.

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
- **2026-11-01 · `FocusHeading` takes the focus only from nothing in particular:** `body`, where it
  falls when a form goes, or `#main-content`, where `RouteFocus` puts it. Anywhere else means
  someone moved on during a slow request or hydration, so they keep their place (WCAG 2.4.3). The
  heading then goes into a `role="status"` beside it, because a screen reader says nothing else
  for "Save your backup codes" or "Email confirmed" (4.1.3), and a tab title isn't spoken by
  itself. Every use today removes whatever held the focus first. A new use that leaves its trigger
  on the page won't get the focus, so remove the trigger or move the focus there.
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
- **2026-11-02 · Owner progress is worked out, never stored.** `onboarding-progress.ts` reads what
  is saved each time, so it can't drift: a step is done when its data would pass its schema, and
  clearing a field reopens the step. Continue is simply the first step not done. Steps stay open in
  any order. The one thing kept is `updated_at`, which every step's save must touch, because the
  reminder reads it.
- **2026-11-02 · A draft is a row in `parking_locations`, not a separate table.** Name, address,
  area, point and rate are nullable, and `parking_locations_complete_check` requires them past
  `draft`/`changes_requested`, so the database still refuses an incomplete listing going live
  however it is asked. Public queries cast their rows to the complete shape on that guarantee: only
  `published` rows reach them. Status is one column; the `in_review` row keeps a real slug from the
  name (Greek transliterated), and drafts hold `draft-<id>`.
- **2026-11-02 · Fields save as they are left, except tax.** `useAutosave` sends only valid values
  that changed, one at a time and in order. Half a step therefore survives, which is the point of
  "pick up where you left off". Tax details are the exception: nothing is stored until the button,
  and saved values never come back to the browser, only their last three characters, so an empty
  field means "keep what's stored". A change of tax country needs a new number with it.
- **2026-11-02 · Tax values are encrypted in the API** (AES-256-GCM, `OWNER_DATA_KEY`) with the
  owner and field as additional data, so a value copied to another row won't decrypt. On this
  machine the key derives from the session secret, so changing that secret makes local tax values
  unreadable. Fields are those DAC7 names (checked against Revenue Ireland's guidance on 2026-11-02;
  EUR-Lex could not be fetched); the adviser confirms them under #18. Not collected: permanent
  establishments ("where available") and the payout account, which Stripe holds in Phase 4.
- **2026-11-02 · Uploads are read inside the route, not by a body parser.** Parsers run before the
  guards, so anyone could make the API buffer megabytes without an account (`read-body.ts`). Bytes
  decide the type, never the header. Every photo is re-encoded by sharp to three WebP widths, which
  drops location and camera metadata; scans uploaded as proof are re-encoded for the same reason,
  PDFs are stored as they came and only ever served as attachments. A file slightly over the limit
  is read to the end and thrown away: answering while the browser is still sending resets the
  connection, and the owner would see a network error instead of "too large". `UploadGate` limits
  what runs at once (16 uploads in all, 2 per user, 2 decoding images), because the rate limit counts
  requests per minute and one image takes 3 of libuv's 4 threads. sharp opens everything with a
  64 MP limit, proofs included: a 1.4 MB PNG decoded to 2.28 GB without one. A file's name goes in
  the URI-encoded `X-File-Name` header, never the query string, which reaches logs.
- **2026-11-03 · Every edit to a draft takes the row lock** (`edit()` in
  `owner-listings.service.ts`): it locks the row, checks the listing is still editable and touches
  `updated_at`. Submit does the same and rechecks completeness inside, so staff can't receive a
  listing whose only photo was deleted a moment earlier, and a check made before the lock proves
  nothing.
- **2026-11-02 · Photos are served by the API at content-hash URLs,** same origin, so the CSP stays
  as it was, and cacheable for ever. The route has its own limit, 1,200 a minute, because one
  results page is dozens of images and the default throttle is per route; it also stops random keys
  costing an S3 read each, which a CDN can't absorb. A 404 caches for a minute, and the year-long
  header goes on successes only. Put a CDN in front at launch. Two listings with the same
  picture share files, so deleting removes a file only when no row still uses its key. Not
  next/image: the sizes already exist, and its optimiser would do the work twice.
- **2026-11-02 · Local uploads and S3 share one interface** (`ObjectStore`), chosen by `S3_BUCKET`.
  Files on disk are allowed only on a loopback origin, as with emails. No MinIO: a new container
  for every developer and CI run, to test a thin adapter. The cost is that the S3 path has only run
  against a mocked client, so try it for real with the first deployment.
- **2026-11-02 · Status emails hang off the column, not on who changed it.** The worker compares
  `status` with `notified_status`, so a status changed by hand in the database emails the owner
  just as Phase 5's admin screen will, with nothing to add there. Each sweep is one statement that
  queues the email and marks it, so a crash can't lose or double one; the dedupe key includes the
  submission time, so a second round of review emails again. This is the transactional outbox
  Phase 3 needs: `email_outbox` holds no addresses (they are looked up when sending), and its id is
  Resend's idempotency key. Booking emails should reuse it.
- **2026-11-02 · Owner emails live in `packages/email`, not the web catalogs,** because the worker
  sends them. Plain functions rather than ICU: no plurals are needed, and it spares the worker
  next-intl. Auth emails keep their catalog text and share the layout and transport.
- **2026-11-02 · Mapbox is allowed across all of `/owner`,** not just the location step: moving
  between steps doesn't load a new document, so the policy in force is that of the page the owner
  arrived on. That still leaves someone arriving from the home page with its policy, so every link
  to the location step is a real page load (`StepLink`, `useStepNavigation`). The map itself loads
  on intent ("Show the map"): it is heavy, and each one shown is a billed map load. The strict
  `mapbox-gl-csp` build is used so no `blob:` worker is needed; its worker is
  copied to `public/vendor` at build time and served from our origin. Classic `streets-v12`, because
  the Standard style needs `wasm-unsafe-eval`. Typed coordinates and "use my location" always stay
  (WCAG 2.5.7, and the page must work with no token). Mapbox is a new processor of owners' IP
  addresses and belongs in the Phase 6 privacy review. **The map has never run:** no token existed
  when it was built.
- **2026-11-02 · How prices combine.** The most specific price wins each half hour: dated, weekend,
  night, hourly (#17), on the listing's wall clock. Length stays real elapsed time (#7), but the
  long-stay threshold reads the wall clock, like the 30-day limit, so a week across the spring change
  still earns its discount. Our reading, as #17 didn't say: a space's own rate scales everything else
  in proportion, cap included, so a space 20% dearer stays 20% dearer at night. All of that is
  `quoteStayMinor`, so a different answer changes one function. Rounding happens once per 24 hours.
  Clock changes are found by halving rather than asking `Intl` per half hour: a 30-day stay across
  50 results would be 72,000 lookups.

- **2026-11-03 · Closures and special hours are a page of their own, not a step**
  (`/owner/listings/:id/closures`), because nothing there is needed to send a listing in and, unlike
  the steps, it stays open once staff have the listing or it is live (#24). Saves go through the
  same row lock as the steps with `edit(…, { anyStatus: true })`. An entry is a date range with
  three kinds (#25, #28): other hours, closed all day, or the week's hours less a closed window.
  Days are whole calendar days on the listing's wall clock, so "closed on the 25th" also closes the
  small hours that the weekly hours give to the 24th's night. A save replaces the list, and entries
  that have ended are never sent back, so they go on the next save; the worker sweeps the rest every
  6 hours, because the note is the owner's free text (GDPR). Copying (#29) is one transaction that
  locks the targets in id order (two copies can't deadlock), each listing all or nothing: an
  identical entry counts as copied, a different one on a shared day is a clash and that listing is
  left alone. It first deletes the targets' ended entries, which nobody can see but the exclusion
  constraint still does. It has its own limit (10 a minute): it can write to 50 listings. A listing
  with staff or live keeps its `updated_at` (only drafts' reminders read it; touching it rewrites
  every index, search's GiST included). The note never leaves the owner API (#26). A first day may
  be up to two horizons back, since an entry still running is sent again on every save. Search drops
  listings closed all day on the stay's days in SQL, because a holiday closes many at once and they
  would fill the candidate batches. **Phase 3:** progress.md lists what must refuse closing time
  over a booking (#27).
- **2026-11-07 · Owner messages come from `app/[locale]/owner/layout.tsx`,** not from each page:
  a layout stays mounted across client navigation, so the catalogue travels once per visit to the
  owner area instead of with every step (`performance.smoke.ts` checks a step change's payload).
  Owner pages must not add their own `ClientMessages` for the owner namespaces again. Signed out,
  the layout adds none: `/owner` is then a landing of server components, and the catalogue is
  7–10 KB gzip of flight data no budget would notice. Page tests render inside `OwnerLayout`.
- **2026-11-07 · The Mapbox worker's file name carries the library's version**
  (`mapbox-gl-csp-worker-<version>.js`, from `mapboxgl.version` in `location-map.tsx` and the
  package in `copy-mapbox-worker.mjs`), so `/vendor/` can be cached for a year with no risk of an
  old worker beside a new library. The copy script deletes other versions.
- **2026-11-07 · A save answers with `progressOne`:** the four counts and the cover photo in one
  statement. `progressOf` (five queries at once) stays for the dashboard's many listings. Inside a
  transaction use `progressOne`: queries run in parallel on one transaction's connection were what
  `pg` warned about ("client is already executing a query").
- **2026-11-07 · Search filters on weekly hours in SQL** (`weekCovers` in `parking.service.ts`):
  the week as a minute-of-week `int4multirange` (`range_agg`, so touching periods merge and a night
  across midnight is one range) must contain the stay's wall-clock span, split where it crosses
  Sunday into Monday. The span is worked out in TypeScript once per supported time zone
  (`weekNeeded` in `opening-hours.ts`) and bound, not per row in SQL: about 15 time-zone
  conversions a candidate otherwise, and a negative wall-clock span (inside the hour the clocks
  repeat) made `int4range` throw. Listings with any closure or special hours on a day of the stay skip it
  (`exceptionDuring`) and are judged by `isOpenThroughout` alone, which stays the authority. Without
  this, an area of listings shut at that hour used up all five batches before reaching an open one.
  Any change to how weekly hours are read must change both.
- **2026-11-07 · Owner pages read only what they show:** the closures page uses
  `GET /owner/listings/:id/hours-exceptions` (name, language, entries) and, like the hours step,
  `GET /owner/listings/:id/others` for where a copy can go. `others` leaves the listing itself out,
  so pages don't filter it. Don't go back to `getOwnerOnboarding` for that list: it counts every step
  of every listing.
- **2026-11-07 · Demo closures are dated from the seed's run** (`fromDay`/`toDay` in
  `demo-data.ts`), as the contract refuses past entries and the worker deletes ended ones. CI seeds
  before every smoke run; a local seed ages, so run `pnpm db:seed` again if the search latency check
  should keep meeting one. They are on Πάρκινγκ Ερμού because no smoke test names it at those hours.
  The near-me test expects the Syntagma garage at whatever hour CI runs, so give it no closures.
- **2026-11-04 · Copying to other listings is one component, `CopyToListings`,** given its texts
  and API call by `CopyHoursExceptions` (closures, #29) and `CopyWeeklyHours` (the week, #30). They
  differ on unsaved changes: the closures page's Save stays put, so it asks for a save first; the
  hours step's Save moves on, so its `prepare` saves the week through the form's own checks and
  copies after. The week replaces the target's (an addition would mean nothing), only drafts and
  listings sent back take it (`locked` otherwise), and an empty week is refused rather than closing
  every listing it reaches (`NOTHING_TO_COPY`).
- **2026-11-03 · A break in the weekly hours is two periods on the day** (#28), read back by
  `periodsToDays` as the first and last of the day's own periods. The form allows one break a day,
  before midnight, so a night that runs past midnight with a break is three periods on one weekday
  (its small hours, morning, evening): `OPENING_PERIODS_MAX` is 21. A morning only counts as the
  night before's when it ends by the time that day opens; otherwise "closes before it opens" can't
  say it, and an untouched save once dropped the day. Known and accepted: a week open all day with a
  daily break is equally "17:00 to 14:00 every night", and reads back that way. The hours are the
  same.

- **2026-11-08 · Holds and bookings are one table, kept apart by one exclusion constraint**
  (`bookings_space_no_overlap`, migration 0015): no two rows `held` or `confirmed` on a space may
  overlap on `[starts_at, blocked_until)`, where `blocked_until` is the end plus the owner's gap
  (#10). That, never a read, is what makes the second of two drivers fail (`SPACE_TAKEN`, #9): their
  insert waits for the first and then hits it. `blocked_until` is a stored column with a CHECK,
  because `timestamptz + interval` isn't immutable and an index expression must be. A hold past its
  time still counts to the constraint until marked `expired`: the hold transaction marks the
  space's lapsed holds first (`skip locked`, since waiting there could deadlock two drivers
  releasing each other's spaces), and the worker sweeps every minute. Availability (search, the
  listing page) ignores lapsed holds by time instead (`spaceTakenDuring` in
  `parking/availability.ts`, which repeats the constraint's `status in (…)` so its index serves).
- **2026-11-08 · Locks go listing first, then booking.** A hold and a confirmation take `FOR SHARE`
  on the listing before reading its hours; the owner's hours saves hold it `FOR UPDATE` (`edit`) or
  `FOR NO KEY UPDATE` (copies), so a closure and a confirmation can't both pass their checks. The
  race test (`bookings.integration.test.ts`, "never lets a closure and a confirmation both
  through") failed 3 of 3 with the lock removed. The closing-time guard (#27, `strandedBookings` in
  `bookings/stranded.ts`) works in memory on the hours as they would be after the save, before
  anything is written, under that lock; the copies report it per listing as `booked`. Only
  confirmed bookings count: a hold isn't a booking, and its confirmation re-reads the hours.
- **2026-11-08 · Saving spaces upserts by label** (it used to delete and re-insert): a booking points
  at its space's row, and a listing staff sent back after it was live can have bookings. Removing a
  space a booking or running hold takes is refused (`LISTING_BOOKED`); one with only past bookings
  goes, and they keep `space_label` with `space_id` null. The demo seed still replaces spaces, so a
  local demo booking loses its space on a reseed.
- **2026-11-08 · The listing page's space picker** (`BookSpaceForm`) gets its labels rendered by the
  server, so it ships only `BookSpace` and `BookingErrors` and no zod; `lib/booking-client.ts`
  mirrors `BOOKING_ERROR_CODES` for that reason, and a test holds the two together. It stays mounted
  while the listing is open for the stay, even with nothing free, because a "just taken" refusal
  refreshes the page, and an unmounted form would take the message with it. With a stay, the API
  sends only the free spaces, so a garage whose first 48 are booked still offers the rest; search's
  "from" price and free count are the free spaces' (#17).
- **2026-11-08 · A booking's page says what was just done through `?done=`** (`confirmed`,
  `cancelled`): the client `router.replace`s to it, `RouteFocus` puts the focus on main, and the
  notice's `FocusHeading` takes it from there. A `done` that doesn't match the booking's status says
  nothing. The 10-minute hold shows the time it ends, with no countdown (a ticking clock either
  speaks all the time or never): `HoldTimer` warns once, two minutes before, offers to keep it for
  longer, and reads the page again when it ends, whose heading then takes the focus (#37).
- **2026-11-08 · Which spaces a stay meets is one probe per listing,** not one per space:
  `takenSpaceIds` (`parking/availability.ts`) on `bookings_taken_by_listing_idx`, a GiST on
  `(location_id, tstzrange(starts_at, blocked_until))` over held and confirmed rows (0017). Search's
  `hasFreeSpace` compares active spaces with active spaces taken, and `spaceStats` joins the taken
  set once. The first version probed each space, and as a column of a subquery Postgres ran that
  probe once per aggregate: 0.7 s for one batch of 100 garages (performance review, on 1.5M
  synthetic bookings). Keep new availability reads on that index.
- **2026-11-08 · The closing-time guard reads only what can matter,** under listing locks that
  block holds: confirmed bookings meeting the days whose entries change (`HoursChange.days`: a
  closures save diffs against what is stored, a copy names the entries it adds), never further back
  than a stay can last, each distinct stay worked out once. A new week (`saveHours`, `copyHours`,
  editable listings only) still reads them all.
- **2026-11-08 · Account names are checked when changed, not only at sign-up** (`withValidName` in
  `packages/auth`'s update hook): owners now see them (#35), and `/update-user` takes any body.
  The owner's list also caps them (`left(name, 100)`) and isolates them (`<bdi>`).
- **2026-11-08 · Answers that need a session are `Cache-Control: private, no-store`**
  (`NoStoreInterceptor`, global): plates and names must never sit in a shared cache. Public routes
  and a route's own `@Header` keep theirs.
- **2026-11-08 · The space picker loads in a bundle of its own** (`BookSpacePicker`, `next/dynamic`
  in a `'use client'` wrapper, still rendered on the server): a server page importing it directly
  shipped it on every listing view, where booking is off outside this machine. `attempt` lives in
  `lib/api-call.ts` so it brings no owner texts; the API client is `sideEffects: false`. The booking
  page checks the plate with `@parkfairy/contracts/plates`, without zod (30 KiB).
- **2026-11-08 · An owner's cancel comes back as `?cancelled=<reference>`,** whose notice takes the
  focus and names the booking: a status region inside the card went with the card, and the focus
  moving cut it off (accessibility review).
- **2026-11-08 · Booking emails go through the outbox in the booking's own transaction**, one row per
  booking, event and reader (`booking:<id>:<event>:<driver|owner>`). The payload holds what the email
  shows and nothing about people: no names, no plate. `packages/email/src/booking-emails.ts` writes
  the stay in the listing's zone, 24-hour in Greek; the layout gained label/value `details`.

- **2026-11-09 · Address search goes through our API, not from the browser to Mapbox** (#40):
  `GET /v1/places/suggestions`, `/places/retrieve` and `/places` (`apps/api/src/places`). The token
  stays on the server and the search page's CSP needs nothing for it. Mapbox has no spending cap, so
  three things stand in front of it (security and performance reviews):
  - the site's hourly budget (`MAPBOX_SEARCH_HOURLY_LIMIT`, 2,000) counts what Mapbox bills: a
    session (one UUID from the first suggestion to the pick) the first time it is seen
    (`SET … NX` in Redis), and each one-off look-up. Counting calls made it about five times too
    tight. While Redis fails it counts per instance, since the request limits then let everything
    through;
  - each visitor gets 100 calls an hour across the three routes (`PlacesVisitorGuard`, one key the
    handler isn't part of), a twentieth of the budget, so one client can't switch search off for all;
  - requests another site's page makes from a visitor's browser are refused (`Sec-Fetch-Site`
    present and not `same-origin`/`none`: an `<img>` would otherwise spend lookups from every
    visitor's own address). The web server's own calls carry no such header.

  After five Mapbox failures in a row the API answers unavailable for 30 s rather than after 3 s
  each. The API's token is `MAPBOX_SEARCH_TOKEN`; `MAPBOX_PUBLIC_TOKEN` stands in on this machine
  only, and outside it the two may not be the same: the public one reaches every browser, and making
  it work from a server would mean lifting its URL restrictions. The web shows the field and the map
  only when it has `MAPBOX_PUBLIC_TOKEN` (`lib/maps.server.ts`), so production sets both. Mapbox's
  results are for temporary use: nothing is cached or stored, answers are `no-store`, and request
  logs drop `q`, `session` and `id` along with positions (`log-redaction.ts`).

- **2026-11-09 · A place in the search URL is `place` + `latitude`/`longitude` + `placeLocale`.** A
  pick fills the position; any edit clears it. Text with no valid position (never picked, typed
  without JavaScript, or a position edited by hand) is looked up once by the page (`lookupPlace`),
  which redirects to the same search with the position, so a reload or a shared link costs no second
  look-up. Only for a search made here or typed in: from another site the page asks for a press of
  Search instead (`Search.lookupPending`). Because the position belongs to the words, the server
  renders the hidden position fields empty when there is a place and the field puts them back after
  hydration: without JavaScript an edited place would otherwise travel with the old position.
  `placeLocale` is the language Mapbox named the place in (the page's at the time), so after a
  language switch the heading marks the words with it; `<title>` can't carry `lang`. Without a token
  nothing can look a place up, so a place with no position is left out
  (`parseSearch(..., { lookups: false })`) and the search asks for an area. An area always wins.
- **2026-11-09 · The address combobox is shadcn `Input` + `Popover`, not `Command` (cmdk).** cmdk
  fixes the input's `id`, `aria-labelledby` and `aria-expanded` (always true) after its props, which
  breaks our `FieldLabel`, the error summary's `#search-place` link and the collapsed state. The
  popover is anchored with `virtualRef`, so it can load on focus without replacing the input (which
  would lose the focus), and it is the listbox itself (`role="listbox"` on `PopoverContent`, options
  only); "nothing found" and failures go to a visible status line under the field instead. It
  renders right after the field (`container`, a `// Parkfairy:` prop on `PopoverContent`): at the end
  of `<body>`, swipe navigation reached it last. Radix makes the list focusable, so a tap on its edge
  can move the focus there; the field takes it back rather than closing the list before the pick
  lands. The current option has an inset ring, as menu items do (the accent fill alone is 1.1:1). The
  API client loads with the list, on focus: imported statically it put about 4 KiB on every home and
  search visit.
- **2026-11-09 · Links into `/search` load a real page where there can be a map (`SearchLink`).** The
  CSP in force is the one of the page a visitor arrived on, and only the search page (and the owner
  area) allows Mapbox (`allowsMaps` in `lib/security/csp.ts`, built from `SUPPORTED_LOCALES`), so a
  client navigation from the home page would refuse the results map. Without a token there is no map
  and the link stays a client navigation, prefetched and quicker. The search form is a plain GET form,
  which loads a page anyway.
- **2026-11-09 · Mapbox makes every marker an image named "Map marker"** (mapbox-gl 3.34 sets
  `role="img"` and `aria-label` on any element it is given that lacks them). The results map's pins
  are links: `results-map.tsx` removes both after creating each marker, and names the pin by its text
  (the number `aria-hidden`, the full name in an `sr-only` span, the listing's name in a `lang` span of
  its own, which an `aria-label` couldn't carry). The test's fake marker copies Mapbox's behaviour.
  The map's own focus rings are in `lib/mapbox-focus.css` (both maps): Mapbox shows focus with a
  box-shadow, which forced colours drop, and the tiles are light in both themes, so the colour is
  fixed. Once shown, the map stays mounted and is only hidden: showing it again was another billed
  map load.
- **2026-11-09 · Bookings keep the listing's name, address and language** (`listing_*`, migration
  0019, L6). The driver's pages and every email read them from the booking; the owner's own pages
  still show the listing as it is now. Name and address are nullable: the backfill met listings sent
  back with their name cleared. 0019 adds, backfills and constrains in one transaction under an
  exclusive lock, which is fine before launch only: on a large `bookings`, add the column nullable,
  deploy the writers, backfill in batches outside the migration, add the CHECK `NOT VALID`, validate
  it, then `SET NOT NULL` (performance review).
- **2026-11-09 · An owner hears of one driver's bookings at most six times a day** (L3,
  `OWNER_EMAILS_PER_DRIVER_DAY`): confirmations and driver's cancellations of the last 24 hours at
  any of the owner's listings, counted on the driver's own bookings inside the transaction, bounded to
  rows with an event in the window. The owner's own cancellations don't count. Past it, the booking
  still shows on the owner's page; the driver's own emails are never capped.
- **2026-11-09 · Per-account hold limits are a route guard, not a second named throttler** (L2,
  `AccountThrottlerGuard` with `@UseGuards`): the global throttler runs before the session is known,
  on purpose, so a flood never reaches the session lookup. The guard re-runs the route's limits with
  the account as the tracker; its keys never meet the per-address ones. Each guard instance builds
  its own `commonOptions`, so a subclass's `getTracker`/`generateKey` stay its own.

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

- **The web app's tests and typecheck read `@parkfairy/contracts` from its `dist`.** After changing
  the contracts, run `pnpm --filter @parkfairy/contracts build` (the same for database and
  api-client), or web tests check against the old values (2026-11-03: a raised period cap looked
  refused).
- **Owner text inside a sentence goes through `t.rich`** with a tag around it
  (`“<listing>{name}</listing>”`), so it can carry its own `lang`. `catalogs.test.ts` checks both
  catalogs use the same tags and formats such messages with `t.rich` (2026-11-03, the first ones).
- **A race test needs several pairs at once.** Locally, two requests in a `Promise.all` rarely
  interleave: the closures race test passed with the row lock removed until it ran three listings'
  pairs per round (2026-11-03).
- **Routes with their own `@Throttle` meet it in integration tests,** where each test user is one
  visitor: copying allows 10 a minute, so its tests use an owner each. Each route keeps its own
  count (the throttler keys by handler): the two copies allow 10 a minute each, not 10 between them.
- **Python fed by a bash heredoc on this machine mangles non-ASCII** such as ’ (Windows code page),
  so a replacement silently fails to match or writes mojibake. Put such scripts in a file written
  with the editor tool, or edit directly (2026-11-03).
- **Returning a `Buffer` from a Nest route sends JSON** (`{"type":"Buffer","data":[…]}`), with a 200
  and no error. Use `StreamableFile`. Only comparing the bytes in a test caught it.
- **`sharp()` throws at construction on an empty buffer,** before any `await`. Build it inside the
  `try`.
- **API tests need an `Origin` on writes** (`OriginGuard`), and a `X-Forwarded-For` per user: every
  test client is otherwise one visitor and meets the rate limits.
- **Photo tests need different pictures.** Files are named by content, so a repeated colour in a
  test image shares a file between listings, and "the file is gone" fails now and then.
- **Radix checkboxes and radios need `ResizeObserver`,** which jsdom lacks; `testing/setup.ts` stubs it.
- **`public/vendor/` is generated** and ignored by git and ESLint. A fresh clone gets it from the
  `dev` and `build` scripts.
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
  note above. A page with no forms has nothing to import it first, so it must load no zod at all,
  and that takes checking the whole graph: on 2026-11-03 the owner dashboard reached the contracts
  through `use-validation-message` → `validation-args`, for four numbers. Those limits now live in
  the zod-free `validation.ts`; `dashboard-bundle.test.ts` makes importing zod there fail.
- **`trackCspViolations` follows the whole test** since 2026-11-03. It kept its list in the window,
  so each navigation threw earlier violations away and it only ever checked the last page. That is
  how the dashboard's violation stayed hidden. To find what called `eval`, wrap `window.Function`
  in a `Proxy` from an init script, report `new Error().stack` with `Error.stackTraceLimit` raised,
  and read those positions in `.next/static/chunks`.
- **`testing-library` joins inline text with no space,** so a step link reads "LocationDone" in
  tests and "Location Done" in a browser. Match `/^Location\s*Done$/`.
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
- **Each integration suite needs a map point of its own** (2026-11-08). The owner suite leaves live
  listings at Heraklion run after run (48 by then), and once more than search's 50 results sat on
  the catalogue suite's point, its own listings fell off the end. Catalogue: Rethymno; bookings:
  Agios Nikolaos; search batches: Chania; owner: Heraklion.
- **Supertest closes its ephemeral server after each request** (2026-11-08): requests built ahead in
  an array fail with "Cannot read properties of null (reading 'address')". Build each as it runs
  (`() => api(...)`).
- **Testing Library's `rerender` drops `renderWithProviders`' providers** (they wrap the element,
  not the `wrapper` option): "context from NextIntlClientProvider was not found". Change props from
  a stateful harness instead.
- **Zod 4 runs `.refine` after a failed `.min`**, so an empty field reported "required" and "invalid"
  together. `.min(1, { message, abort: true })` stops there (2026-11-08).
- **The React lint calls `Date.now()` impure during render**, server components included;
  `new Date().getTime()` reads the same clock and passes. Read it once per render.
- **`vi.mock` of a source file that another module imports lazily didn't take** (2026-11-09): with
  `React.lazy` or `next/dynamic` around `import('./results-map')`, the real module loaded even though
  the mock's factory ran. Mock the library underneath instead (`mapbox-gl/dist/mapbox-gl-csp.js`), as
  `results-map-toggle.test.tsx` does.
- **The owner integration suite suspends earlier runs' live listings at its point** (2026-11-10): they
  pile up in the test database run after run, and past search's 50 results this run's own fell off
  the end at random (their slugs carry a random tag), failing four search tests in a full run only.
- **The test `getPathname` returns the path `Link` renders** (`test/navigation-mock.tsx`, 2026-11-09):
  it used to return undefined, so plain `<a href={getPathname(…)}>` links had no href in tests.
- **A bash heredoc with nested quotes can break the shell** ("unexpected EOF while looking for
  matching"), besides mangling non-ASCII: put such scripts in a file.

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
- 2026-11-03 (owner onboarding): `/en/owner`, its profile and tax pages and the location step are
  held to the 250 KiB budget in `performance.smoke.ts`. The location step must request nothing from
  Mapbox on a first visit, because the map loads on intent.
- 2026-11-03 (closures, estimated from the build by the performance review): the closures page
  about 227 KiB (zod 31 KiB of it), a listing step about 237 KiB (13 KiB under the budget), the
  public listing page unchanged at 167 KiB: its closures table renders on the server only.
- 2026-11-04 (weekly hours copy, the same method): a listing step about 238.5 KiB, the closures
  page about 227.6 KiB, `/en/owner` 175 KiB. The shared copy section added about 1.5 KiB.
- 2026-11-09 (address search and the results map, from the build manifests by the performance
  review): `/en` 173.3 KiB, `/en/search` 174.0 KiB, the owner listing step 234.2 KiB (the tightest,
  16 KiB under the budget), auth pages 222–224 KiB. That was before the API client moved out of the
  address field's first load (about 4 KiB less on `/en` and `/en/search`). The suggestion list loads
  on focus (about 6 KiB, plus 18 KiB shared with the date picker); the map's own chunk, its CSS and
  the 481 KiB library on hover or press, the worker (268 KiB) after.
- 2026-11-08 (booking, `performance.smoke.ts` on production builds): the public listing page 185
  KiB at first, signed in with the picker or not, because the server page imported it; 169 KiB once
  it loaded through `BookSpacePicker`, 185 KiB where it shows. A booking's page 210 KiB with zod for
  the plate, 176 KiB with `contracts/plates`. `/en/bookings` 167 KiB, `/en/search` 172 KiB.
- **Smoke tests that hold sign up a driver of their own** (`ownDriver`), never the shared account:
  one hold per driver, and the suite runs in parallel. Inside `test.use({ storageState })`, a context
  from `browser.newContext()` starts signed in too, so `ownDriver` passes an empty `storageState`;
  without it the sign-up form never showed and the test timed out (2026-11-08).

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
- **2026-11-04 · The copy status lines name their subject,** "Το ωράριο αντιγράφηκε…" (the week,
  singular) and "Οι ημερομηνίες αντιγράφηκαν…" (the dates, plural). The difference in number is
  deliberate: don't make them agree. They sit in one shared component and are read alone.
- Language names are always shown in their own language (`LOCALE_ENDONYMS`).
- **2026-11-08 · A stay is «στάθμευση» in Greek, not «παραμονή»** (which reads as a hotel stay), as
  the catalogue already had it (`Listing.yourStay`, `spaceTotal`). The booking copy follows; a native
  speaker may still prefer otherwise (progress.md).
