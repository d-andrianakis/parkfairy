import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FetchFn } from './mapbox-search.js';
import { PlacesService } from './places.service.js';

const SESSION = '0b6f2a7e-6c1d-4f5e-9a3b-2c8d7e1f4a90';
const QUERY = { q: 'Ermou', session: SESSION, locale: 'el' } as const;

function service(token: string | null, fetchFn: FetchFn, limit = 100) {
  return new PlacesService(
    { mapboxSearchToken: token, MAPBOX_SEARCH_HOURLY_LIMIT: limit },
    null,
    fetchFn,
  );
}

const ok: FetchFn = () => Promise.resolve(Response.json({ suggestions: [] }));

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  return ((error as ServiceUnavailableException).getResponse() as { code: string }).code;
}

describe('PlacesService', () => {
  it('without a token, is unavailable and calls nobody', async () => {
    const fetchFn = vi.fn(ok);
    expect(await codeOf(service(null, fetchFn).suggest(QUERY))).toBe('PLACES_UNAVAILABLE');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stops calling Mapbox once the hour is spent', async () => {
    const fetchFn = vi.fn<FetchFn>(() => Promise.resolve(Response.json({ features: [] })));
    const places = service('pk.token', fetchFn, 2);
    const lookup = { q: 'Ermou', locale: 'el' } as const;
    await places.find(lookup);
    await places.find(lookup);
    expect(await codeOf(places.find(lookup))).toBe('PLACES_UNAVAILABLE');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('answers a Mapbox refusal as unavailable, never with what Mapbox said', async () => {
    const refused: FetchFn = () =>
      Promise.resolve(Response.json({ message: 'Invalid token' }, { status: 401 }));
    expect(await codeOf(service('pk.token', refused).find({ q: 'Ermou', locale: 'en' }))).toBe(
      'PLACES_UNAVAILABLE',
    );
  });

  it('stops asking a Mapbox that keeps failing, for a while, then asks again', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn<FetchFn>(() => Promise.reject(new TypeError('fetch failed')));
      const places = service('pk.token', fetchFn);
      for (let n = 0; n < 5; n++) await places.find({ q: 'Ermou', locale: 'el' }).catch(() => null);
      expect(fetchFn).toHaveBeenCalledTimes(5);
      expect(await codeOf(places.find({ q: 'Ermou', locale: 'el' }))).toBe('PLACES_UNAVAILABLE');
      expect(fetchFn).toHaveBeenCalledTimes(5);
      vi.advanceTimersByTime(30_001);
      fetchFn.mockImplementation(() => Promise.resolve(Response.json({ features: [] })));
      await expect(places.find({ q: 'Ermou', locale: 'el' })).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('spends the budget once per session, as Mapbox bills it', async () => {
    const fetchFn = vi.fn(ok);
    const places = service('pk.token', fetchFn, 1);
    for (let n = 0; n < 4; n++) await places.suggest(QUERY);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const other = { ...QUERY, session: '1c7e9b2a-3d4f-4a5b-8c6d-7e8f9a0b1c2d' };
    expect(await codeOf(places.suggest(other))).toBe('PLACES_UNAVAILABLE');
  });

  it('answers a network failure as unavailable too', async () => {
    const broken: FetchFn = () => Promise.reject(new TypeError('fetch failed'));
    expect(await codeOf(service('pk.token', broken).suggest(QUERY))).toBe('PLACES_UNAVAILABLE');
  });

  it('gives the picked place, or null when Mapbox no longer knows it', async () => {
    const found: FetchFn = () =>
      Promise.resolve(
        Response.json({
          features: [{ geometry: { coordinates: [23.7, 37.9] }, properties: { name: 'Syntagma' } }],
        }),
      );
    const pick = { id: 'dXJu', session: SESSION, locale: 'el' } as const;
    await expect(service('pk.token', found).retrieve(pick)).resolves.toEqual({
      label: 'Syntagma',
      latitude: 37.9,
      longitude: 23.7,
    });
    const gone: FetchFn = () => Promise.resolve(Response.json({ features: [] }));
    await expect(service('pk.token', gone).retrieve(pick)).resolves.toBeNull();
  });
});
