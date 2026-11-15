import { vi } from 'vitest';

/**
 * What server components get from `next-intl/server`, built on the real catalogs, so pages render
 * in tests with the words people read. Used with `vi.mock('next-intl/server', serverIntl)`.
 */
export async function serverIntl() {
  const [{ createTranslator, createFormatter }, en, el] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
    import('@/messages/el.json'),
  ]);
  const catalogs = { en: en.default, el: el.default };
  type Locale = keyof typeof catalogs;
  return {
    getLocale: () => Promise.resolve('en'),
    getTranslations: (options: string | { locale?: Locale; namespace: string }) => {
      const { locale = 'en', namespace } =
        typeof options === 'string' ? { namespace: options } : options;
      return Promise.resolve(
        createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never }),
      );
    },
    getFormatter: ({ locale = 'en' }: { locale?: Locale } = {}) =>
      Promise.resolve(createFormatter({ locale, timeZone: 'Europe/Athens' })),
  };
}

/** `notFound()` throws in Next; so does this, with a name the tests can look for. */
export const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
