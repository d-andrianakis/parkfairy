import { defineConfig } from '@hey-api/openapi-ts';

// Input is emitted by `pnpm --filter @parkfairy/api openapi:emit`; both files are committed
// and CI fails if regenerating them produces a diff.
export default defineConfig({
  input: './openapi.json',
  // Prettier over the output: the generator writes one line for every import, thousands of
  // characters long once there are a few hundred operations.
  output: { path: './src/generated', postProcess: ['prettier'] },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@tanstack/react-query',
  ],
});
