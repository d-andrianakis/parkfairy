import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from this package's directory; the shared .env lives at the repo root.
const rootEnv = resolve('../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  // Keep PostGIS-owned objects (e.g. spatial_ref_sys) out of introspection and push diffs.
  extensionsFilters: ['postgis'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
