import { SUPPORTED_LOCALES, VALIDATION_MESSAGES, type Locale } from '@parkfairy/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_KEYS } from '@/lib/auth-errors';
import el from './el.json';
import en from './en.json';

type Catalog = { [key: string]: string | Catalog };
const catalogs: Record<Locale, Catalog> = { el, en };
const reference = flatten(en);

function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

/**
 * ICU argument names in a message. Braces at odd nesting depth open arguments
 * (`{name}`, `{role, select, ...}`); even depths are select/plural branch bodies.
 */
function icuArguments(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      depth++;
      if (depth % 2 === 1) {
        const match = /^\s*([A-Za-z_]\w*)/.exec(message.slice(i + 1));
        if (match?.[1]) names.add(match[1]);
      }
    } else if (message[i] === '}') {
      depth--;
    }
  }
  return [...names].sort();
}

describe('message catalogs', () => {
  it('exist for exactly the supported locales', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  describe.each(Object.entries(catalogs) as [Locale, Catalog][])('%s', (locale, catalog) => {
    const messages = flatten(catalog);

    it('has exactly the reference (English) keys', () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());
    });

    it('uses the same ICU arguments as English in every message', () => {
      for (const [key, message] of Object.entries(messages)) {
        expect(icuArguments(message), key).toEqual(icuArguments(reference[key] ?? ''));
      }
    });

    it('has no empty messages and every message formats', () => {
      const t = createTranslator({
        locale,
        messages: catalog,
        onError: (error) => {
          throw error;
        },
      });
      for (const [key, message] of Object.entries(messages)) {
        expect(message.trim(), key).not.toBe('');
        const args = Object.fromEntries(icuArguments(message).map((name) => [name, 'x']));
        expect(() => (t as (k: string, a: object) => string)(key, args), key).not.toThrow();
      }
    });
  });

  it('translates every validation key used by the contracts', () => {
    for (const key of VALIDATION_MESSAGES) expect(reference).toHaveProperty([`Validation.${key}`]);
  });

  it('translates every auth error the UI can show', () => {
    for (const key of AUTH_ERROR_KEYS) expect(reference).toHaveProperty([`AuthErrors.${key}`]);
  });
});
