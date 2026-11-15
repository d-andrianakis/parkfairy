import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    // next-intl's middleware imports `next/server` without its extension, which Node's ESM refuses.
    server: { deps: { inline: ['next-intl'] } },
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
