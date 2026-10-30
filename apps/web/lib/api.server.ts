import 'server-only';
import {
  createClient,
  createConfig,
  getFeaturedParking,
  getParkingListing,
  searchParking,
  type ParkingListingDetail,
  type ParkingListingSummary,
  type ParkingSearchResponse,
} from '@parkfairy/api-client';
import { isListingSlug, type ParkingSearchQuery } from '@parkfairy/contracts';
import { unstable_cache } from 'next/cache';
import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * Server components call the API directly (browsers use the same-origin /api proxy). These
 * are public catalogue reads, so no cookies are forwarded.
 */
const serverApi = createClient(
  createConfig({ baseUrl: process.env.API_URL ?? 'http://localhost:4000' }),
);

/** A slow API must not hold page renders (or the web server's sockets) for long. */
const TIMEOUT_MS = 4000;

/**
 * Passes the visitor's `X-Forwarded-For` on, as the /api rewrite does, so the API rate-limits
 * per visitor rather than per web server. Production must set the API's TRUST_PROXY to the
 * proxy chain in front of it (see memory.md); the first proxy must overwrite or append the
 * header so visitors cannot choose their own rate-limit key.
 */
async function forwardedFor(): Promise<Record<string, string>> {
  const forwarded = (await headers()).get('x-forwarded-for');
  return forwarded ? { 'x-forwarded-for': forwarded } : {};
}

const loadFeatured = unstable_cache(
  async () => {
    const { data } = await getFeaturedParking({
      client: serverApi,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!data) throw new Error('Featured listings unavailable'); // not cached
    return data.listings;
  },
  ['featured-parking'],
  // The same for everyone; owners editing listings (Phase 2) should revalidate this tag.
  { revalidate: 300, tags: ['featured-parking'] },
);

/** Home page extras must never take the page down: no listings if the API is unreachable. */
export async function loadFeaturedListings(): Promise<ParkingListingSummary[]> {
  try {
    return await loadFeatured();
  } catch {
    return [];
  }
}

/** Search results, or null when the API could not answer. Cached per request (metadata + page). */
export const loadSearchResults = cache(
  async (
    area: string | undefined,
    latitude: number | undefined,
    longitude: number | undefined,
    start: string,
    end: string,
  ): Promise<ParkingSearchResponse | null> => {
    try {
      const { data } = await searchParking({
        client: serverApi,
        query: { area: area as ParkingSearchQuery['area'], latitude, longitude, start, end },
        headers: await forwardedFor(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return data ?? null;
    } catch {
      return null;
    }
  },
);

/**
 * A published listing, `'not-found'` (unknown, unpublished or malformed slug) or
 * `'unavailable'` (the API failed). Primitive arguments so `cache()` shares one request
 * between `generateMetadata` and the page.
 */
export const loadListing = cache(
  async (
    slug: string,
    start: string | undefined,
    end: string | undefined,
  ): Promise<ParkingListingDetail | 'not-found' | 'unavailable'> => {
    if (!isListingSlug(slug)) return 'not-found';
    try {
      const { data, response } = await getParkingListing({
        client: serverApi,
        path: { slug },
        query: start && end ? { start, end } : undefined,
        headers: await forwardedFor(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response?.status === 404) return 'not-found';
      return data ?? 'unavailable';
    } catch {
      return 'unavailable';
    }
  },
);
