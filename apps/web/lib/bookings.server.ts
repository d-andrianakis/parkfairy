import 'server-only';
import {
  createClient,
  createConfig,
  getListingBookings,
  getMyBooking,
  getMyBookings,
  type Booking,
  type BookingList,
  type OwnerListingBookings,
} from '@parkfairy/api-client';
import { headers } from 'next/headers';
import { cache } from 'react';

const bookingsApi = createClient(
  createConfig({ baseUrl: process.env.API_URL ?? 'http://localhost:4000' }),
);

/** A slow API must not hold page renders for long. */
const TIMEOUT_MS = 4000;

/**
 * Bookings are read as the person signed in: the session cookie goes along and the API decides
 * whose bookings these are, as it does for the browser. The address goes too, for its limits.
 */
async function asVisitor() {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  const forwarded = incoming.get('x-forwarded-for');
  return {
    client: bookingsApi,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
}

type Loaded<T> = T | 'not-found' | 'unavailable';

/** One of the driver's bookings; another driver's is `'not-found'`, as one that doesn't exist. */
export const loadBooking = cache(async (id: string): Promise<Loaded<Booking>> => {
  try {
    const { data, response } = await getMyBooking({ ...(await asVisitor()), path: { id } });
    if (data) return data;
    return response?.status === 404 ? 'not-found' : 'unavailable';
  } catch {
    return 'unavailable';
  }
});

/** A page of the driver's bookings, or null when the API could not answer. */
export const loadBookings = cache(
  async (when: 'upcoming' | 'past', page: number): Promise<BookingList | null> => {
    try {
      const { data } = await getMyBookings({ ...(await asVisitor()), query: { when, page } });
      return data ?? null;
    } catch {
      return null;
    }
  },
);

/** A page of an owner's listing's bookings; another owner's listing is `'not-found'`. */
export const loadOwnerBookings = cache(
  /** Strings, not an object, so the page and its metadata share one request (`cache` keys). */
  async (id: string, after = '', before = ''): Promise<Loaded<OwnerListingBookings>> => {
    try {
      const { data, response } = await getListingBookings({
        ...(await asVisitor()),
        path: { id },
        query: { ...(after ? { after } : {}), ...(before ? { before } : {}) },
      });
      if (data) return data;
      return response?.status === 404 ? 'not-found' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  },
);
