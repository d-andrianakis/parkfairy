import { describe, expect, it } from 'vitest';
import {
  PLACE_ID_PATTERN,
  placeLabel,
  PlaceRetrieveQuerySchema,
  PlaceSearchQuerySchema,
  PlaceSuggestQuerySchema,
} from './places.js';
import { PLACE_QUERY_LIMITS } from './validation.js';

const SESSION = '0b6f2a7e-6c1d-4f5e-9a3b-2c8d7e1f4a90';

function issues(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];
}

describe('suggestion queries', () => {
  it('takes the text trimmed, a session and a locale', () => {
    const parsed = PlaceSuggestQuerySchema.parse({
      q: '  Ermou 10 ',
      session: SESSION,
      locale: 'el',
    });
    expect(parsed).toEqual({ q: 'Ermou 10', session: SESSION, locale: 'el' });
  });

  it('waits for a few letters, and refuses an essay', () => {
    const short = PlaceSuggestQuerySchema.safeParse({ q: ' Er ', session: SESSION, locale: 'en' });
    expect(issues(short)).toEqual(['q:placeTooShort']);
    const long = 'a'.repeat(PLACE_QUERY_LIMITS.max + 1);
    expect(
      issues(PlaceSuggestQuerySchema.safeParse({ q: long, session: SESSION, locale: 'en' })),
    ).toEqual(['q:textTooLong']);
  });

  it('needs a session id and a supported locale', () => {
    const result = PlaceSuggestQuerySchema.safeParse({ q: 'Ermou', session: 'abc', locale: 'de' });
    expect(issues(result).map((issue) => issue.split(':')[0])).toEqual(['session', 'locale']);
  });
});

describe('place ids', () => {
  it.each(['dXJuOm1ieHBsYzpBUVRC', 'dXJuOm1ieGFkcjo2ZjM1+/w==', 'a.b_c-d'])('accepts %s', (id) => {
    expect(PLACE_ID_PATTERN.test(id)).toBe(true);
    expect(PlaceRetrieveQuerySchema.safeParse({ id, session: SESSION, locale: 'el' }).success).toBe(
      true,
    );
  });

  // The id goes back to Mapbox in a URL path, with our token.
  it.each([
    '..',
    '.',
    '/search',
    'a/../../geocoding',
    'a/./b',
    'a/..',
    '%2e%2e',
    'a b',
    'a?b',
    'a#b',
    '',
    'x'.repeat(513),
  ])('refuses %s, which could name another endpoint', (id) => {
    expect(PlaceRetrieveQuerySchema.safeParse({ id, session: SESSION, locale: 'el' }).success).toBe(
      false,
    );
  });
});

describe('a typed place looked up once', () => {
  it('has the same limits as a suggestion', () => {
    expect(issues(PlaceSearchQuerySchema.safeParse({ q: 'Σύ', locale: 'el' }))).toEqual([
      'q:placeTooShort',
    ]);
    expect(PlaceSearchQuerySchema.parse({ q: 'Σύνταγμα', locale: 'el' }).q).toBe('Σύνταγμα');
  });
});

describe('placeLabel', () => {
  it('names the place, then where it is', () => {
    expect(placeLabel({ name: 'Ermou 10', detail: '105 63 Athens, Greece' })).toBe(
      'Ermou 10, 105 63 Athens, Greece',
    );
  });

  it('says it once when the name already holds the rest, or there is no rest', () => {
    expect(placeLabel({ name: 'Athens, Greece', detail: 'Greece' })).toBe('Athens, Greece');
    expect(placeLabel({ name: 'Syntagma', detail: '' })).toBe('Syntagma');
  });

  it('fits the place a search URL can carry', () => {
    const label = placeLabel({ name: 'x'.repeat(150), detail: 'y'.repeat(150) });
    expect(label).toHaveLength(PLACE_QUERY_LIMITS.max);
  });
});
