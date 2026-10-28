---
name: i18n
description: How to add or change user-visible text, locale-aware formatting, and localized routes in Parkfairy (Greek + English, next-intl). Use whenever UI copy, dates, numbers, prices, emails, or error messages change.
---

# Internationalization

Locales: `el` (default) and `en`, defined once in `packages/contracts/src/i18n.ts`
(`SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `DEFAULT_TIME_ZONE = Europe/Athens`).

## Adding text

1. Add the key to **both** `apps/web/messages/en.json` (reference) and `el.json`, in the
   namespace of the component (`SignIn`, `Account`, …). Same keys, same ICU arguments.
2. Server components: `const t = await getTranslations({ locale, namespace })`
   (get `locale` via `localeFromParams(params)`). Client components: `useTranslations(namespace)`.
3. Use ICU for variation instead of string concatenation:
   - plurals: `{count, plural, one {# space} other {# spaces}}` (Greek needs this too)
   - choices: `{role, select, admin {…} other {…}}`
4. Page titles via `generateMetadata` with translated `metaTitle`.
5. The lint rule `i18next/no-literal-string` fails on literal JSX text and user-visible
   attributes (`aria-label`, `alt`, `title`, `placeholder`, `label`, `hint`, `error`).
6. `pnpm --filter @parkfairy/web test` runs the catalog parity/ICU/coverage test.

## Validation and server errors

- Contract schemas use keys from `VALIDATION_MESSAGES`; render with `useValidationMessage()`.
- Server errors: map stable `code`s to keys (see `lib/auth-errors.ts`) and translate. Never
  display server-provided English text.

## Formatting

- Dates/times: `format.dateTime(date, { dateStyle: 'long' })` (`useFormatter` / `getFormatter`);
  the configured zone is Europe/Athens. Use `<time dateTime={iso}>`.
- Money: `format.number(minor / 100, { style: 'currency', currency })`. Amounts stay integers
  in minor units until display.
- Never `toLocaleString()` without explicit locale, never hand-built date strings.

## Routing

- Use `Link`, `useRouter`, `redirect`, `usePathname` from `@/i18n/navigation` (locale-aware).
- New pages go under `app/[locale]/`; unknown URLs fall through to `app/global-not-found.tsx`.

## Content quality

- Greek: formal plural "you" (εσείς) in UI copy, Greek question mark `;`, typographic
  ellipsis `…`. Flag new Greek strings for native review in progress.md.
- Language names are endonyms (`LOCALE_ENDONYMS`) and carry `lang`.

## Adding a locale

New catalog file, add to `SUPPORTED_LOCALES`, `pnpm db:generate` (widens `users_locale_check`),
endonym, smoke + catalog tests pick it up automatically.
