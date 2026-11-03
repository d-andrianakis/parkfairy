import { describe, expect, it, vi } from 'vitest';
import { findAddress } from './mapbox-geocode';

const feature = {
  id: 'a',
  geometry: { coordinates: [23.73, 37.97] },
  properties: { full_address: 'Ερμού 1, Αθήνα' },
};

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('findAddress', () => {
  it('asks for permanent results in Greece, in the page’s language', async () => {
    const fetchFn = respond({ features: [] });
    await findAddress('Ερμού 1', 'pk.token', 'el', fetchFn);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin).toBe('https://api.mapbox.com');
    expect(url.searchParams.get('q')).toBe('Ερμού 1');
    expect(url.searchParams.get('country')).toBe('gr');
    expect(url.searchParams.get('language')).toBe('el');
    expect(url.searchParams.get('permanent')).toBe('true');
  });

  it('turns longitude-first coordinates the right way round', async () => {
    const matches = await findAddress('x', 't', 'el', respond({ features: [feature] }));
    expect(matches).toEqual([
      { id: 'a', address: 'Ερμού 1, Αθήνα', latitude: 37.97, longitude: 23.73 },
    ]);
  });

  it('falls back to the name when there is no full address', async () => {
    const named = { ...feature, properties: { name: 'Σύνταγμα' } };
    const matches = await findAddress('x', 't', 'el', respond({ features: [named] }));
    expect(matches?.[0]?.address).toBe('Σύνταγμα');
  });

  it('answers null when Mapbox refuses or can’t be reached', async () => {
    expect(await findAddress('x', 't', 'el', respond({}, 401))).toBeNull();
    const down = vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')));
    expect(await findAddress('x', 't', 'el', down)).toBeNull();
  });
});
