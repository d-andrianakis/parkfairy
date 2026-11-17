import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';
import { simpleImportSort } from './base.js';
import { noLiteralStrings } from './i18n.js';

export const nextConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  simpleImportSort,
  noLiteralStrings(['app/**/*.tsx', 'components/**/*.tsx']),
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', 'coverage/**']),
  prettier,
]);
