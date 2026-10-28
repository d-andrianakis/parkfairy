import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './support/env';

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
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
        {
          command: 'pnpm --filter @parkfairy/web start',
          url: 'http://localhost:3000/en',
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
      ],
});
