import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const simpleImportSort = {
  plugins: { 'simple-import-sort': simpleImportSortPlugin },
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
};

/**
 * Type-aware lint config for Node packages and services.
 * @param {string} tsconfigRootDir directory of the consuming package (pass `import.meta.dirname`)
 */
export function baseConfig(tsconfigRootDir) {
  return defineConfig([
    globalIgnores(['dist/**', 'coverage/**', '**/*.gen.ts']),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    simpleImportSort,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['**/*.js', '**/*.mjs'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  ]);
}
