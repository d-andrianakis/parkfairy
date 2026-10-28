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

3. Start the web app, the API and the worker, in watch mode:

   ```sh
   pnpm dev
   ```

   It is ready when the URLs below respond. The first request to each web page compiles
   it, so expect a few seconds' delay the first time.

## Check that it works

| What          | URL                                | Expected                                               |
| ------------- | ---------------------------------- | ------------------------------------------------------ |
| Web app       | http://localhost:3000              | Redirects to `/el` or `/en` from your browser language |
| API docs      | http://localhost:4000/docs         | Swagger UI                                             |
| API readiness | http://localhost:4000/health/ready | `{"status":"ok","checks":{"database":"up"}}`           |
| Worker health | http://localhost:4100              | `{"status":"ok"}`                                      |

Then create an account in the web app. The account page shows the identity the API derived
from your session cookie, which proves the web app, auth, API and database are connected.

## Browser automation for Claude Code (Playwright MCP)

`.mcp.json` registers a Playwright MCP server, so Claude Code can drive a real Chrome window
against the local app. Use it for exploratory testing, for drafting smoke specs, and for
trying injection payloads against your own forms.

- **Requirements:** `pnpm install` (the server is a pinned dev dependency) and Google Chrome.
- **First use:** Claude Code asks you to approve the project's MCP server. Check it with
  `/mcp`. A session that was already open must be restarted to pick it up.
- **Limits:** the browser starts with a fresh profile every session, so sign in each time. It
  is restricted to `localhost:3000`, `4000` and `4100`. That prevents accidental visits to
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

## Before you commit

```sh
pnpm lint && pnpm typecheck && pnpm test   # static checks, unit and integration tests
pnpm build && pnpm test:smoke              # production build, then Playwright smoke suite
```

`pnpm test` runs the API integration tests against the `parkfairy_test` database, which
`pnpm db:up` creates the first time the Postgres container starts.
