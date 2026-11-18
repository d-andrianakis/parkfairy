import 'server-only';

import {
  type Booking,
  type BookingList,
  createClient,
  createConfig,
  type FavouriteList,
  getCalendar,
  getEarnings,
  getListingBookings,
  getMyBooking,
  getMyBookings,
  getMyFavourites,
  getMyVehicles,
  isMyFavourite,
  listOwnerBookings,
  type OwnerBookingList,
  type OwnerCalendar,
  type OwnerEarnings,
  type OwnerListingBookings,
  type SavedVehicle,
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

/**
 * The signed-in owner's earnings (5.1): their own part of each booking, after commission. `after`
 * is a place an earlier page gave out; null when the API could not answer.
 */
export const loadOwnerEarnings = cache(async (after = ''): Promise<OwnerEarnings | null> => {
  try {
    const { data } = await getEarnings({
      ...(await asVisitor()),
      query: after ? { after } : {},
    });
    return data ?? null;
  } catch {
    return null;
  }
});

/**
 * The signed-in owner's calendar for a month and, optionally, one listing (5.1); null when the API
 * could not answer, or refused a month or listing that is not one. Strings, not an object, so the
 * page and its metadata share one request (`cache` keys).
 */
export const loadOwnerCalendar = cache(
  async (month = '', listing = ''): Promise<OwnerCalendar | null> => {
    try {
      const { data } = await getCalendar({
        ...(await asVisitor()),
        query: { ...(month ? { month } : {}), ...(listing ? { listing } : {}) },
      });
      return data ?? null;
    } catch {
      return null;
    }
  },
);

/**
 * The bookings of every listing the signed-in account runs (5.1), a page at a time; null when the
 * API could not answer or refused the query. Strings, not an object, so the page and its metadata
 * share one request (`cache` keys); the empty string leaves a part of the query out.
 */
export const loadOwnerBookingList = cache(
  async (
    status: 'upcoming' | 'past' | 'cancelled' | '' = '',
    listing = '',
    from = '',
    to = '',
    after = '',
    before = '',
  ): Promise<OwnerBookingList | null> => {
    try {
      const { data } = await listOwnerBookings({
        ...(await asVisitor()),
        query: {
          ...(status ? { status } : {}),
          ...(listing ? { listing } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(after ? { after } : {}),
          ...(before ? { before } : {}),
        },
      });
      return data ?? null;
    } catch {
      return null;
    }
  },
);

/** The driver's saved vehicles (5A.2), or null when the API could not answer. */
export const loadVehicles = cache(async (): Promise<SavedVehicle[] | null> => {
  try {
    const { data } = await getMyVehicles(await asVisitor());
    return data?.vehicles ?? null;
  } catch {
    return null;
  }
});

/** The driver's favourite listings that are still live, newest first; null when the API failed. */
export const loadFavourites = cache(async (): Promise<FavouriteList['listings'] | null> => {
  try {
    const { data } = await getMyFavourites(await asVisitor());
    return data?.listings ?? null;
  } catch {
    return null;
  }
});

/** Whether the signed-in driver has favoured a listing; null when the API could not say. */
export const loadFavouriteState = cache(async (slug: string): Promise<boolean | null> => {
  try {
    const { data } = await isMyFavourite({ ...(await asVisitor()), path: { slug } });
    return data?.favourite ?? null;
  } catch {
    return null;
  }
});
