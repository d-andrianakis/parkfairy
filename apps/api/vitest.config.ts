import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Local runs read the shared root .env; CI provides the variables directly.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** The same Redis on another logical database (`redis://host:port/15`), or ''. */
function redisDatabase(url: string | undefined, database: number): string {
  if (!url) return '';
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export default defineConfig({
  // Nest's dependency injection relies on emitted decorator metadata; Vite's Oxc
  // transformer emits it when configured for legacy decorators.
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    environment: 'node',
    // Unit tests sit next to the code (src/**/*.test.ts); integration tests that need
    // Postgres live in test/ (*.integration.test.ts).
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      // Apps under test count rate limits in memory, so suites and repeated runs never share
      // counters. rate-limit.integration.test.ts uses Redis, on its own logical database.
      REDIS_URL: '',
      TEST_REDIS_URL: process.env.TEST_REDIS_URL ?? redisDatabase(process.env.REDIS_URL, 15),
    },
    // Integration suites share one database.
    fileParallelism: false,
  },
});
