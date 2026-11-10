import { describe, expect, it, vi } from 'vitest';
import {
  findPlaces,
  MapboxError,
  retrievePlace,
  suggestPlaces,
  type FetchFn,
} from './mapbox-search.js';

const SESSION = '0b6f2a7e-6c1d-4f5e-9a3b-2c8d7e1f4a90';
const TOKEN = 'pk.secret-ish';

function answering(body: unknown, status = 200) {
  return vi.fn<FetchFn>(() => Promise.resolve(Response.json(body, { status })));
}

const feature = (name: string, lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { name, place_formatted: '105 63 Athens, Greece', ...extra },
});

describe('suggestPlaces', () => {
  it('asks for Greek places in the page language, with the session and token', async () => {
    const fetchFn = answering({ suggestions: [] });
    await suggestPlaces({ q: 'Ermou 10', session: SESSION, token: TOKEN, locale: 'el', fetchFn });
    const url = fetchFn.mock.calls[0]?.[0] as URL;
    expect(url.origin + url.pathname).toBe('https://api.mapbox.com/search/searchbox/v1/suggest');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'Ermou 10',
      session_token: SESSION,
      access_token: TOKEN,
      language: 'el',
      country: 'gr',
      limit: '5',
    });
    expect(url.searchParams.get('types')).not.toMatch(/country|region|category/);
  });

  it('gives each suggestion its id, name and where it is, dropping ids it could not send back', async () => {
    const fetchFn = answering({
      suggestions: [
        { mapbox_id: 'dXJuOm1ieGFkcg', name: 'Ermou 10', place_formatted: '105 63 Athens' },
        { mapbox_id: '../retrieve', name: 'Odd' },
        { mapbox_id: 'dXJuOm1ieHBsYw', name: 'Syntagma' },
      ],
    });
    await expect(
      suggestPlaces({ q: 'Er', session: SESSION, token: TOKEN, locale: 'en', fetchFn }),
    ).resolves.toEqual([
      { id: 'dXJuOm1ieGFkcg', name: 'Ermou 10', detail: '105 63 Athens' },
      { id: 'dXJuOm1ieHBsYw', name: 'Syntagma', detail: '' },
    ]);
  });

  it('turns a refusal, a failure, a timeout and a strange answer into its own error', async () => {
    const run = (fetchFn: FetchFn) =>
      suggestPlaces({ q: 'Ermou', session: SESSION, token: TOKEN, locale: 'el', fetchFn });
    await expect(run(answering({ message: 'Not Authorized' }, 401))).rejects.toMatchObject({
      status: 401,
    });
    await expect(run(() => Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({
      status: 'network',
    });
    await expect(
      run(() => Promise.reject(new DOMException('slow', 'TimeoutError'))),
    ).rejects.toMatchObject({ status: 'timeout' });
    await expect(run(answering({ suggestions: 'nope' }))).rejects.toMatchObject({
      status: 'shape',
    });
  });

  it('never carries the token in its message, which reaches the logs', async () => {
    const error = await suggestPlaces({
      q: 'Ermou',
      session: SESSION,
      token: TOKEN,
      locale: 'el',
      fetchFn: answering({}, 403),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapboxError);
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });
});

describe('retrievePlace', () => {
  it('keeps the id inside its path segment', async () => {
    const fetchFn = answering({ type: 'FeatureCollection', features: [] });
    await retrievePlace({ id: 'abc/def==', session: SESSION, token: TOKEN, locale: 'el', fetchFn });
    const url = fetchFn.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/search/searchbox/v1/retrieve/abc%2Fdef%3D%3D');
    expect(url.searchParams.get('session_token')).toBe(SESSION);
  });

  it('reads the position, preferring the properties, and labels it', async () => {
    const fetchFn = answering({
      type: 'FeatureCollection',
      features: [
        feature('Ermou 10', 23.7, 37.9, {
          coordinates: { latitude: 37.976543219, longitude: 23.733211117 },
        }),
      ],
    });
    await expect(
      retrievePlace({ id: 'dXJu', session: SESSION, token: TOKEN, locale: 'en', fetchFn }),
    ).resolves.toEqual({
      label: 'Ermou 10, 105 63 Athens, Greece',
      latitude: 37.97654,
      longitude: 23.73321,
    });
  });

  it('falls back to the geometry, longitude first, and is null when nothing came', async () => {
    const withGeometry = answering({ features: [feature('Syntagma', 23.735, 37.975)] });
    await expect(
      retrievePlace({
        id: 'dXJu',
        session: SESSION,
        token: TOKEN,
        locale: 'el',
        fetchFn: withGeometry,
      }),
    ).resolves.toMatchObject({ latitude: 37.975, longitude: 23.735 });
    const empty = answering({ features: [] });
    await expect(
      retrievePlace({ id: 'dXJu', session: SESSION, token: TOKEN, locale: 'el', fetchFn: empty }),
    ).resolves.toBeNull();
  });
});

describe('findPlaces', () => {
  it('looks text up without a session and skips features it cannot place', async () => {
    const fetchFn = answering({
      features: [
        { type: 'Feature', geometry: null, properties: { name: 'Broken' } },
        feature('Syntagma', 23.735, 37.975),
        feature('Far away', 23.7, 137),
      ],
    });
    const places = await findPlaces({ q: 'Σύνταγμα', token: TOKEN, locale: 'el', fetchFn });
    expect(places.map((place) => place.label)).toEqual(['Syntagma, 105 63 Athens, Greece']);
    const url = fetchFn.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/search/searchbox/v1/forward');
    expect(url.searchParams.has('session_token')).toBe(false);
  });
});
