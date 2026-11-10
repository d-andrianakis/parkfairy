import {
  isPlaceId,
  PLACE_SUGGESTIONS_MAX,
  placeLabel,
  type Locale,
  type Place,
  type PlaceSuggestion,
} from '@parkfairy/contracts';
import { z } from 'zod';

/**
 * Mapbox's Search Box API, from the server (decision #40). Suggestions carry no position; the one
 * picked is retrieved with the same session id, which ends the session Mapbox bills. `/forward`
 * looks text up in one call (billed per call), for what was never picked.
 *
 * Everything it returns is for temporary use (Mapbox's terms): it answers a search and is not
 * kept, cached or stored. Every URL here carries the token, so no URL is ever logged.
 */

const BASE = 'https://api.mapbox.com/search/searchbox/v1';
/** Greece only; nearer Athens first, where the curated areas and the demo listings are. */
const COUNTRY = 'gr';
const PROXIMITY = '23.7275,37.9838';
/** What a driver parks near. Not countries, regions or categories ("parking"), too wide for 5 km. */
const TYPES = 'place,city,locality,neighborhood,street,address,poi,postcode';
const TIMEOUT_MS = 3000;

export type FetchFn = (url: URL, init: { signal: AbortSignal }) => Promise<Response>;

/** Mapbox said no, failed, or was too slow. Its status, never its URL (the token is in it). */
export class MapboxError extends Error {
  constructor(readonly status: number | 'timeout' | 'network' | 'shape') {
    super(`Mapbox search failed: ${status}`);
  }
}

const SuggestResponse = z.object({
  suggestions: z.array(
    z.object({
      mapbox_id: z.string(),
      name: z.string(),
      place_formatted: z.string().optional(),
    }),
  ),
});

const Feature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
  properties: z.object({
    name: z.string(),
    place_formatted: z.string().optional(),
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  }),
});
const FeatureCollection = z.object({ features: z.array(z.unknown()) });

interface Common {
  token: string;
  locale: Locale;
  fetchFn?: FetchFn;
}

async function call(url: URL, fetchFn: FetchFn): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new MapboxError(
      error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
    );
  }
  if (!response.ok) throw new MapboxError(response.status);
  try {
    return await response.json();
  } catch {
    throw new MapboxError('shape');
  }
}

function url(path: string, params: Record<string, string>): URL {
  const target = new URL(`${BASE}/${path}`);
  target.search = new URLSearchParams(params).toString();
  return target;
}

/** Five decimals is about a metre: as near as anyone parks. */
const round = (value: number) => Math.round(value * 1e5) / 1e5;

/** One feature as a place, or null when it lacks what a search needs. */
function toPlace(raw: unknown): Place | null {
  const parsed = Feature.safeParse(raw);
  if (!parsed.success) return null;
  const { geometry, properties } = parsed.data;
  const latitude = properties.coordinates?.latitude ?? geometry.coordinates[1];
  const longitude = properties.coordinates?.longitude ?? geometry.coordinates[0];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    label: placeLabel({ name: properties.name, detail: properties.place_formatted ?? '' }),
    latitude: round(latitude),
    longitude: round(longitude),
  };
}

function features(body: unknown): Place[] {
  const parsed = FeatureCollection.safeParse(body);
  if (!parsed.success) throw new MapboxError('shape');
  return parsed.data.features.map(toPlace).filter((place) => place !== null);
}

export async function suggestPlaces({
  q,
  session,
  token,
  locale,
  fetchFn = fetch,
}: Common & { q: string; session: string }): Promise<PlaceSuggestion[]> {
  const body = await call(
    url('suggest', {
      q,
      session_token: session,
      access_token: token,
      language: locale,
      country: COUNTRY,
      proximity: PROXIMITY,
      types: TYPES,
      limit: String(PLACE_SUGGESTIONS_MAX),
    }),
    fetchFn,
  );
  const parsed = SuggestResponse.safeParse(body);
  if (!parsed.success) throw new MapboxError('shape');
  return parsed.data.suggestions
    .filter((suggestion) => isPlaceId(suggestion.mapbox_id))
    .slice(0, PLACE_SUGGESTIONS_MAX)
    .map((suggestion) => ({
      id: suggestion.mapbox_id,
      name: suggestion.name,
      detail: suggestion.place_formatted ?? '',
    }));
}

/** The picked suggestion's position; null when Mapbox no longer knows it. */
export async function retrievePlace({
  id,
  session,
  token,
  locale,
  fetchFn = fetch,
}: Common & { id: string; session: string }): Promise<Place | null> {
  // `isPlaceId` refuses `.` and `..` parts; encoding keeps a `/` inside the one segment.
  const body = await call(
    url(`retrieve/${encodeURIComponent(id)}`, {
      session_token: session,
      access_token: token,
      language: locale,
    }),
    fetchFn,
  );
  return features(body)[0] ?? null;
}

/** Text looked up in one call: the best matches first. */
export async function findPlaces({
  q,
  token,
  locale,
  fetchFn = fetch,
}: Common & { q: string }): Promise<Place[]> {
  const body = await call(
    url('forward', {
      q,
      access_token: token,
      language: locale,
      country: COUNTRY,
      proximity: PROXIMITY,
      types: TYPES,
      limit: String(PLACE_SUGGESTIONS_MAX),
    }),
    fetchFn,
  );
  return features(body).slice(0, PLACE_SUGGESTIONS_MAX);
}
