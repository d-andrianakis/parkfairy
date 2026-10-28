import { defineConfig } from '@hey-api/openapi-ts';

// Input is emitted by `pnpm --filter @parkfairy/api openapi:emit`; both files are committed
// and CI fails if regenerating them produces a diff.
export default defineConfig({
  input: './openapi.json',
  output: { path: './src/generated' },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@tanstack/react-query',
  ],
});
