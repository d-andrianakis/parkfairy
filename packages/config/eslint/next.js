import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';
import { noLiteralStrings } from './i18n.js';

export const nextConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noLiteralStrings(['app/**/*.tsx', 'components/**/*.tsx']),
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', 'coverage/**']),
  prettier,
]);
