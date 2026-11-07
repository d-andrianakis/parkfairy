import 'server-only';
import {
  createClient,
  createConfig,
  getListingHoursExceptions,
  getOtherOwnerListings,
  getOwnerListing,
  getOwnerOnboarding,
  getOwnerProfile,
  type OwnerListing,
  type OwnerListingClosures,
  type OwnerOnboarding,
  type OwnerOtherListings,
  type OwnerProfile,
} from '@parkfairy/api-client';
import { headers } from 'next/headers';
import { cache } from 'react';

const ownerApi = createClient(
  createConfig({ baseUrl: process.env.API_URL ?? 'http://localhost:4000' }),
);

/** A slow API must not hold page renders for long. */
const TIMEOUT_MS = 4000;

/**
 * An owner's pages read the API as that owner: the session cookie goes along, so the API decides
 * what they may see, as it does for the browser. The address goes too, for per-visitor limits.
 */
async function asVisitor(): Promise<Record<string, string>> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  const forwarded = incoming.get('x-forwarded-for');
  return {
    ...(cookie ? { cookie } : {}),
    ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
  };
}

const request = async () => ({
  client: ownerApi,
  headers: await asVisitor(),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});

/** The dashboard's data, or null when the API could not answer. */
export const loadOwnerOnboarding = cache(async (): Promise<OwnerOnboarding | null> => {
  try {
    const { data } = await getOwnerOnboarding(await request());
    return data ?? null;
  } catch {
    return null;
  }
});

export const loadOwnerProfile = cache(async (): Promise<OwnerProfile | null> => {
  try {
    const { data } = await getOwnerProfile(await request());
    return data ?? null;
  } catch {
    return null;
  }
});

/** A listing of this owner, `'not-found'` (also another owner's) or `'unavailable'`. */
export const loadOwnerListing = cache(
  async (id: string): Promise<OwnerListing | 'not-found' | 'unavailable'> => {
    try {
      const { data, response } = await getOwnerListing({ ...(await request()), path: { id } });
      if (data) return data;
      return response?.status === 404 ? 'not-found' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  },
);

/** A listing's name and closures, or why not: the closures page's one read of the listing. */
export const loadOwnerClosures = cache(
  async (id: string): Promise<OwnerListingClosures | 'not-found' | 'unavailable'> => {
    try {
      const { data, response } = await getListingHoursExceptions({
        ...(await request()),
        path: { id },
      });
      if (data) return data;
      return response?.status === 404 ? 'not-found' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  },
);

/** The owner's other listings, for a copy to go to; none when the API can't say. */
export const loadOtherListings = cache(
  async (id: string): Promise<OwnerOtherListings['listings']> => {
    try {
      const { data } = await getOtherOwnerListings({ ...(await request()), path: { id } });
      return data?.listings ?? [];
    } catch {
      return [];
    }
  },
);
