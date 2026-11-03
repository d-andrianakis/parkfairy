import i18next from 'eslint-plugin-i18next';

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

/**
 * All user-visible text comes from the message catalogs; literal UI text is a bug. Shared
 * components count too: shadcn ships English sr-only text ("Close", "Previous") that must
 * become a prop the app fills from its catalogs.
 * @param {string[]} files globs of the components to check (tests are excluded)
 */
export function noLiteralStrings(files) {
  return {
    files,
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
            exclude: [
              't[A-Z]?\\w*',
              'register',
              'registerSaved',
              'require',
              'includes',
              'startsWith',
              'endsWith',
            ],
          },
        },
      ],
    },
  };
}
