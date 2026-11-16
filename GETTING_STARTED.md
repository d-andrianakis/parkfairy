# Getting started

How to install Parkfairy and run it locally. For what each app and package does, see
[README.md](README.md).

## Requirements

- **Node 24+** (see `.nvmrc`)
- **pnpm 10**: `corepack enable` installs the version pinned in `package.json`
- **Docker Desktop**, running. It hosts Postgres and Redis.

## First-time install

Run these once, from the repository root.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create your environment file:

   ```sh
   cp .env.example .env              # PowerShell: Copy-Item .env.example .env
   ```

3. In `.env`, replace `BETTER_AUTH_SECRET` with a random value of at least 32 characters.
   `openssl` is usually missing on Windows, so use Node:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   The other defaults in `.env.example` work for local development as they are.

4. Optional, needed only for the smoke tests: download the Playwright browser.

   ```sh
   pnpm --filter @parkfairy/smoke-tests exec playwright install chromium
   ```

## Start everything

1. Start Docker Desktop and wait for the engine to finish starting. `docker info` should
   print without errors.

2. Start Postgres and Redis, then apply any new migrations:

   ```sh
   pnpm db:up
   pnpm db:migrate
   ```

   `pnpm db:up` waits until both containers report healthy. Run `pnpm db:migrate` after
   every pull, because it applies only the migrations that are new.

3. Load the demo data (once, and again whenever you want it reset):

   ```sh
   pnpm db:seed
   ```

   It adds 14 fictional parking listings in Athens, Piraeus and Thessaloniki (named spaces,
   opening hours, prices) and a demo account. It is safe to re-run: listings are reset to
   their demo state and the account is created only once. It refuses to run against a
   non-local database or with `NODE_ENV=production`, because the password below is public.

4. Start the web app, the API and the worker, in watch mode:

   ```sh
   pnpm dev
   ```

   It is ready when the URLs below respond. The first request to each web page compiles
   it, so expect a few seconds' delay the first time.

## Check that it works

| What          | URL                                | Expected                                                   |
| ------------- | ---------------------------------- | ---------------------------------------------------------- |
| Web app       | http://localhost:3000              | Redirects to `/el` or `/en` from your browser language     |
| Staff app     | http://localhost:3001              | Redirects to the staff sign-in (see "Reviewing a listing") |
| API docs      | http://localhost:4000/docs         | Swagger UI                                                 |
| API readiness | http://localhost:4000/health/ready | `{"status":"ok","checks":{"database":"up"}}`               |
| Worker health | http://localhost:4100              | `{"status":"ok"}`                                          |

The home page shows featured demo parking, and the search finds listings by area or your
location for any half-hour window. Listings are public, so no account is needed to browse.

Then sign in. The account page shows the identity the API derived from your session cookie,
which proves the web app, auth, API and database are connected.

## Demo account

Created by `pnpm db:seed`, for local databases only:

| Email              | Password              | Language |
| ------------------ | --------------------- | -------- |
| `demo@example.com` | `parkfairy-demo-2026` | Greek    |

The credentials live in `apps/api/src/seed/demo-data.ts`. They are deliberately public, so
never seed a shared or production database (the seed refuses to). The address needs no
confirming.

## Emails on your machine

New accounts must confirm their address before the first sign-in. Locally nothing is really
sent: each email becomes a JSON file in `.emails/` at the repository root, which git ignores.
To finish signing up or resetting a password, open the newest file and paste the link from
its `text` field into your browser. A confirmation link opens a page with a button; pressing
it is what confirms the address. Running the smoke suite empties the folder.

Those files hold working confirmation and password-reset links, so don't share them. Delete the folder whenever you
like. To send real emails, set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`. Anywhere other
than this machine the web app refuses to start without them, and it checks its other settings
at start-up too.

If you were already running `pnpm dev` when this arrived, restart it: the auth instance
survives hot reloads, so it keeps the old rules until the server restarts.

## Listing parking on your machine

"List parking" in the header opens the owner area. Uploads become files in `.uploads/` at the
repository root, which git ignores. Anywhere other than this machine the API refuses to start
without `S3_BUCKET` and `OWNER_DATA_KEY` (`openssl rand -base64 32`). Losing that key loses every
saved tax number, so keep it in the secret store and back it up.

**The map.** Set `MAPBOX_PUBLIC_TOKEN` in `.env` to a public token (`pk...`) from a Mapbox account,
restricted to your site's URLs, and restart the web app. Without one, the location step offers
"Use my location" and typed coordinates instead. Address search stores what it finds, so it uses
Mapbox's permanent geocoding, which needs a card on the Mapbox account.

**Reviewing a listing.** Staff use their own app, http://localhost:3001 (`apps/admin`, on its own
origin so its cookie never reaches the public site). Nothing there creates accounts, so make a staff
account by hand, in three steps:

1. Sign up on the public site as usual and confirm the email (the link is a file in `.emails/`).
2. Turn on two-factor from the account page (http://localhost:3000/en/account). The staff screens and
   every admin API route refuse an account without it.
3. Make the account staff in the database, then sign in at http://localhost:3001 with your password
   and a code from the authenticator app:

```sh
docker exec -it parkfairy-postgres-1 psql -U parkfairy -d parkfairy
```

```sql
update users set role = 'admin' where email = 'you@example.com';
```

The queue lists what owners sent in, oldest first. Open one to see the listing, its owners (tax
numbers only by their last three characters) and the proof documents; then approve it or send it back
with a note. Staff can't decide a listing they own, co-own or manage. Every decision, and every proof
document opened, is a line in the audit log. The worker notices the status change and emails the owner
within about two minutes. A staff session ends a week after sign-in whatever you do, on purpose.

**When someone loses their authenticator (#13).** Support removes the second factor, after checking
who is asking. Staff open Accounts, type the person's whole email address (there is no list and no
partial search), and use "Remove two-factor authentication" with a note of how they were identified
(a ticket reference and the kind of check, up to 100 characters: never names, ID numbers or document
details, since the note stays in the audit log for good and nothing can erase it). The person is
signed out everywhere, their password is cancelled, and they are emailed a link to set a new one:
the reset proves they hold the mailbox, which a note nobody can check does not. Opening an account's
page is itself a line in the audit log. The procedure around it:

1. Never act on a message alone. Check who is asking by a way the account's holder controls: a video
   call with an ID next to their face, or a reply from a different channel you already trust.
2. Write the check into the note, remove the factor, and tell the person to use the email's link to set
   a new password, sign in and turn two-factor on again from their account page.
3. A staff member's own factor, or another staff member's, is not removed in the app (a stolen staff
   session must not open the others' accounts). Recover it by hand, with two people present:
   `delete from two_factors where user_id = '…'; update users set two_factor_enabled = false where id = '…';
delete from sessions where user_id = '…';`, then they turn it on again.

**Taking a listing down, or an account (moderation).** On a live listing's review page, "Suspend this
listing" takes it out of search and stops new bookings. Its note is read by its owners on their
dashboard, so write it for them; tick "Also cancel its upcoming bookings" to refund and tell the drivers
(a stay that has begun is never cancelled; unticked, bookings that exist stand). "Reinstate" brings it
back; that note is for the audit log only. On an account's page, "Suspend this account" ends its
sessions and stops it signing in; the person is told without your reason, which stays in the audit
log (a ticket reference and a few words). Nothing the account owns changes: the page counts the live
listings it is the primary owner of, which stay live until you suspend them one by one. Staff accounts,
and your own, are never suspended from the app. Each moderation button is limited to five a minute per person.

The staff app needs `ADMIN_URL` in `.env` (see `.env.example`); the API reads the same variable to accept
its writes. Don't add it to `TRUSTED_ORIGINS`, which the public site's sign-in also trusts.

Proof documents are in `.uploads/proofs/<listing id>/`. They have no file extension; the type is in
`parking_proof_documents`.

## Booking on your machine

Pick dates on a listing, sign in, choose a space and press "Book this space". The space is kept for
you for 10 minutes while you give the car's number plate and confirm. Payments come in Phase 4, so
for now Confirm charges nothing, and it works only on this machine: anywhere else (an origin that
isn't `localhost`) the listing page still says booking is coming soon and the API refuses holds.
Booking emails go out from the worker within about 30 seconds, into `.emails/` like the others.
Your bookings are under "Bookings" in the header; an owner finds a listing's bookings on its card
in the owner area, where they can cancel one (the driver gets everything back). You can't book
your own listing, so use a second account, or the demo account on the demo listings.

## Browser automation for Claude Code (Playwright MCP)

`.mcp.json` registers a Playwright MCP server, so Claude Code can drive a real Chrome window
against the local app. Use it for exploratory testing, for drafting smoke specs, and for
trying injection payloads against your own forms.

- **Requirements:** `pnpm install` (the server is a pinned dev dependency) and Google Chrome.
- **First use:** Claude Code asks you to approve the project's MCP server. Check it with
  `/mcp`. A session that was already open must be restarted to pick it up.
- **Limits:** the browser starts with a fresh profile every session, so sign in each time. It
  is restricted to `localhost:3000`, `4000` and `4100` (not the staff app on `3001`). That prevents accidental visits to
  real sites, but it is not a security boundary, because redirects and WebSockets aren't
  filtered. Test only your local instance, never staging, production or third-party
  services.
- **Files:** automatically named screenshots and snapshots go to `.playwright-mcp/`, which
  git ignores. A tool call with an explicit filename writes relative to the repo root
  instead, so put those files under `.playwright-mcp/` too.
- **Data:** page snapshots and screenshots are sent to the model. Use a throwaway local
  account and made-up data, never a copy of real user data.
- **`browser_run_code_unsafe`** runs arbitrary code on your machine, outside the browser and
  outside the limits above. Read each call before approving it, and never choose "don't ask
  again" for it. Payload testing only needs `browser_evaluate`, which runs inside the page.
- **To change it,** edit the arguments in `.mcp.json`. For example, add `"--headless"` to
  hide the browser window. `node node_modules/@playwright/mcp/cli.js --help` lists every
  option. Never add `--port`, `--host`, `--extension`, `--cdp-endpoint`, `--user-data-dir`,
  `--allow-unrestricted-file-access`, `--save-session` or `--caps storage`. They expose
  browser control to the network, or give the agent your real browser sessions and files.

## Stop

- **Dev servers:** press `Ctrl+C` in the terminal running `pnpm dev`.
- **Database containers:** `pnpm db:down`. Your data is kept in Docker volumes. If you
  leave the containers running, they restart by themselves whenever Docker Desktop starts.

## Troubleshooting

- **`failed to connect to the docker API ... dockerDesktopLinuxEngine`:** Docker Desktop
  isn't running. Start it and wait for the engine before running `pnpm db:up`.
- **`ECONNREFUSED` on port 5434 or 6380:** the containers are stopped. Run `pnpm db:up`.
- **Why ports 5434 and 6380?** They avoid clashing with a local Postgres on 5432 or Redis on 6379. Don't change them in `.env` without changing `docker-compose.yml` as well.
- **Port 3000, 4000 or 4100 already in use:** another `pnpm dev` is probably still running.
  Stop it, or find the process with `netstat -ano | findstr :3000`.
- **Sign-in or sign-up is rate limited:** Better Auth allows 3 attempts per 10 seconds per
  IP. Wait a few seconds and try again.
- **An older local account says to confirm its email:** sign in once to send a new link, then
  find it in `.emails/`. Run `pnpm db:seed` if it's the demo account. The worker deletes
  accounts still unconfirmed after 7 days.
- **An email never arrived:** one recipient gets at most 5 of each kind per hour, and 1 notice
  that an address is already registered, counting `+tag` addresses as the same inbox. Beyond
  that they are dropped and the web app logs `recipient limit reached`. Each kind also has a
  site-wide hourly budget (`site limit reached`).

## Before you commit

```sh
pnpm lint && pnpm typecheck && pnpm test   # static checks, unit and integration tests
pnpm build && pnpm test:smoke              # production build, then Playwright smoke suite
```

`pnpm test` runs the API integration tests against the `parkfairy_test` database, which
`pnpm db:up` creates the first time the Postgres container starts.
