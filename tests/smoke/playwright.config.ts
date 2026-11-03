import { defineConfig, devices } from '@playwright/test';
import { VISITOR_HEADERS, WEB_URL } from './support/env';

const isCI = Boolean(process.env.CI);
const external = Boolean(process.env.SMOKE_WEB_URL);

/**
 * Smoke suite: one `*.smoke.ts` per feature, exercising the critical path of the running
 * system in a real browser. Runs against production builds (`pnpm build` first).
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    extraHTTPHeaders: VISITOR_HEADERS,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'smoke',
      testMatch: /.*\.smoke\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'pnpm --filter @parkfairy/api start',
          url: 'http://localhost:4000/health',
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
        {
          command: 'pnpm --filter @parkfairy/worker start',
          url: 'http://localhost:4100/health',
          // As for the web app: owner emails must stay on this machine.
          env: { RESEND_API_KEY: '' },
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
        {
          command: 'pnpm --filter @parkfairy/web start',
          url: 'http://localhost:3000/en',
          // A key in a developer's .env must not send real mail to the suite's addresses.
          env: { RESEND_API_KEY: '' },
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
      ],
});
