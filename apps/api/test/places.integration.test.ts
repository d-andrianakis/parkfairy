import {
  ErrorResponseSchema,
  PlaceListSchema,
  PlaceSchema,
  PlaceSuggestionsSchema,
} from '@parkfairy/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import type { FetchFn } from '../src/places/mapbox-search.js';
import { PLACES_FETCH } from '../src/places/places.service.js';
import { createTestApp, type TestApp } from './test-app.js';

const SESSION = '0b6f2a7e-6c1d-4f5e-9a3b-2c8d7e1f4a90';
const TOKEN = 'pk.integration-test';

/** Mapbox as the docs describe it; what each call asked for is kept. */
const mapbox = vi.fn<FetchFn>((url) => {
  if (url.pathname.endsWith('/suggest')) {
    return Promise.resolve(
      Response.json({
        suggestions: [
          { mapbox_id: 'dXJuOm1ieGFkcg', name: 'Ermou 10', place_formatted: '105 63 Athens' },
        ],
        attribution: '© Mapbox',
      }),
    );
  }
  const features = url.pathname.includes('/retrieve/unknown')
    ? []
    : [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [23.7329, 37.9762] },
          properties: { name: 'Ermou 10', place_formatted: '105 63 Athens' },
        },
      ];
  return Promise.resolve(Response.json({ type: 'FeatureCollection', features }));
});

let visitor = 0;
/** Each test its own visitor: the routes have limits per address. */
const get = (app: TestApp, path: string, address = `198.51.100.${++visitor}`) =>
  request(app.getHttpServer()).get(`/v1${path}`).set('X-Forwarded-For', address);

describe('places (decision #40)', () => {
  let app: TestApp;
  let unconfigured: TestApp;

  beforeAll(async () => {
    app = await createTestApp([], (builder) =>
      builder
        .overrideProvider(PLACES_FETCH)
        .useValue(mapbox)
        .overrideProvider(ENV)
        .useValue({ ...loadEnv(), mapboxSearchToken: TOKEN }),
    );
    unconfigured = await createTestApp([], (builder) =>
      builder
        .overrideProvider(PLACES_FETCH)
        .useValue(mapbox)
        .overrideProvider(ENV)
        .useValue({ ...loadEnv(), mapboxSearchToken: null }),
    );
  });
  afterAll(async () => {
    await app.close();
    await unconfigured.close();
  });
  beforeEach(() => {
    mapbox.mockClear(); // braces: a returned function would run as a cleanup hook
  });

  it('suggests places to anyone, uncached, without saying where they are yet', async () => {
    const response = await get(app, '/places/suggestions')
      .query({ q: 'Ermou', session: SESSION, locale: 'el' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(PlaceSuggestionsSchema.parse(response.body)).toEqual({
      suggestions: [{ id: 'dXJuOm1ieGFkcg', name: 'Ermou 10', detail: '105 63 Athens' }],
    });
    // Nothing of Mapbox's own reaches the browser: not its token, not its attribution field.
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    const asked = mapbox.mock.calls[0]?.[0];
    expect(asked?.searchParams.get('access_token')).toBe(TOKEN);
    expect(asked?.searchParams.get('session_token')).toBe(SESSION);
  });

  it('gives the picked place a position, in the same session', async () => {
    const response = await get(app, '/places/retrieve')
      .query({ id: 'dXJuOm1ieGFkcg', session: SESSION, locale: 'en' })
      .expect(200);
    expect(PlaceSchema.parse(response.body)).toEqual({
      label: 'Ermou 10, 105 63 Athens',
      latitude: 37.9762,
      longitude: 23.7329,
    });
    expect(mapbox.mock.calls[0]?.[0].pathname).toBe('/search/searchbox/v1/retrieve/dXJuOm1ieGFkcg');
  });

  it('keeps every answer out of caches, Mapbox’s results being for the moment only', async () => {
    const pick = await get(app, '/places/retrieve')
      .query({ id: 'dXJuOm1ieGFkcg', session: SESSION, locale: 'en' })
      .expect(200);
    const lookup = await get(app, '/places').query({ q: 'Ermou', locale: 'el' }).expect(200);
    expect(pick.headers['cache-control']).toBe('no-store');
    expect(lookup.headers['cache-control']).toBe('no-store');
  });

  it('gives another site’s page nothing, from a visitor’s browser', async () => {
    const response = await get(app, '/places')
      .set('Sec-Fetch-Site', 'cross-site')
      .query({ q: 'Ermou', locale: 'el' })
      .expect(403);
    expect(ErrorResponseSchema.parse(response.body).code).toBe('CROSS_SITE');
    await get(app, '/places')
      .set('Sec-Fetch-Site', 'same-origin')
      .query({ q: 'Ermou', locale: 'el' })
      .expect(200);
    expect(mapbox).toHaveBeenCalledOnce();
  });

  it('says so when the picked place is gone', async () => {
    const response = await get(app, '/places/retrieve')
      .query({ id: 'unknown', session: SESSION, locale: 'el' })
      .expect(404);
    expect(ErrorResponseSchema.parse(response.body).code).toBe('PLACE_NOT_FOUND');
  });

  it('looks typed text up once', async () => {
    const response = await get(app, '/places').query({ q: 'Ερμού 10', locale: 'el' }).expect(200);
    expect(PlaceListSchema.parse(response.body).places).toHaveLength(1);
    expect(mapbox.mock.calls[0]?.[0].pathname).toBe('/search/searchbox/v1/forward');
  });

  it('refuses what it would not send on, before calling Mapbox', async () => {
    for (const query of [
      { q: 'Er', session: SESSION, locale: 'el' },
      { q: 'Ermou', session: 'not-a-uuid', locale: 'el' },
      { q: 'Ermou', session: SESSION, locale: 'de' },
    ]) {
      const response = await get(app, '/places/suggestions').query(query).expect(400);
      expect(ErrorResponseSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
    }
    for (const id of ['..', '.', '%2e%2e']) {
      await get(app, '/places/retrieve').query({ id, session: SESSION, locale: 'el' }).expect(400);
    }
    expect(mapbox).not.toHaveBeenCalled();
  });

  it('limits each visitor, as every call is billed', async () => {
    const address = '198.51.100.250';
    for (let n = 0; n < 20; n++) {
      await get(app, '/places', address).query({ q: 'Ermou', locale: 'el' }).expect(200);
    }
    await get(app, '/places', address).query({ q: 'Ermou', locale: 'el' }).expect(429);
  });

  it('is unavailable without a token, and calls nobody', async () => {
    const response = await get(unconfigured, '/places/suggestions')
      .query({ q: 'Ermou', session: SESSION, locale: 'el' })
      .expect(503);
    expect(ErrorResponseSchema.parse(response.body).code).toBe('PLACES_UNAVAILABLE');
    expect(mapbox).not.toHaveBeenCalled();
  });
});
