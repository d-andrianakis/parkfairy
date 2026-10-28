import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import i18next from 'eslint-plugin-i18next';
import { defineConfig, globalIgnores } from 'eslint/config';

// Attributes people see or hear. Anything else (href, variant, autoComplete, …) is code.
const USER_VISIBLE_ATTRIBUTES = [
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'label',
  'hint',
  'error',
];

export const nextConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // All user-visible text comes from the message catalogs; literal UI text is a bug.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': { include: USER_VISIBLE_ATTRIBUTES },
          // Option objects such as { dateStyle: 'long' } are configuration, not copy.
          'object-properties': { exclude: ['.*'] },
          // Translators are named t / tSomething (useTranslations namespaces).
          callees: {
            exclude: ['t[A-Z]?\\w*', 'register', 'require', 'includes', 'startsWith', 'endsWith'],
          },
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts', 'coverage/**']),
  prettier,
]);
