import 'server-only';

import {
  type AdminBooking,
  type AdminListingReview,
  type AdminOverstay,
  type AdminOverstays,
  type AdminPayments,
  type AdminQueue,
  type AdminUser,
  type AuditLog,
  createClient,
  createConfig,
  getAdminBooking,
  getAdminListing,
  getAdminOverstay,
  getAdminOverstays,
  getAdminPayments,
  getAdminQueue,
  getAdminUser,
  getAuditLog,
} from '@parkfairy/api-client';
import type { AdminAuditQuery, AdminOverstaysQuery, AdminQueueQuery } from '@parkfairy/contracts';
import { headers } from 'next/headers';
import { cache } from 'react';

const adminApi = createClient(
  createConfig({ baseUrl: process.env.API_URL ?? 'http://localhost:4000' }),
);

/** A slow API must not hold page renders for long. */
const TIMEOUT_MS = 4000;

/**
 * Staff pages read the API as the signed-in account: the session cookie goes along, so the API
 * decides what they may see, as it does for the browser. The address goes too, for rate limits.
 */
async function asStaff(): Promise<Record<string, string>> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  const forwarded = incoming.get('x-forwarded-for');
  return {
    ...(cookie ? { cookie } : {}),
    ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
  };
}

const request = async () => ({
  client: adminApi,
  headers: await asStaff(),
  signal: AbortSignal.timeout(TIMEOUT_MS),
});

/** What a page learns when the API doesn't give it data. */
export type Missing = 'not-found' | 'forbidden' | 'unavailable';

function missing(status: number | undefined): Missing {
  if (status === 404) return 'not-found';
  if (status === 401 || status === 403) return 'forbidden';
  return 'unavailable';
}

/** A page of the queue, or why there isn't one. Primitive arguments so `cache` shares the call. */
export const loadQueue = cache(
  async (
    status: AdminQueueQuery['status'],
    after: string | undefined,
  ): Promise<AdminQueue | Missing> => {
    try {
      const { data, response } = await getAdminQueue({
        ...(await request()),
        query: { status, after },
      });
      return data ?? missing(response?.status);
    } catch {
      return 'unavailable';
    }
  },
);

export const loadReview = cache(async (id: string): Promise<AdminListingReview | Missing> => {
  try {
    const { data, response } = await getAdminListing({ ...(await request()), path: { id } });
    return data ?? missing(response?.status);
  } catch {
    return 'unavailable';
  }
});

export const loadUser = cache(async (id: string): Promise<AdminUser | Missing> => {
  try {
    const { data, response } = await getAdminUser({ ...(await request()), path: { id } });
    return data ?? missing(response?.status);
  } catch {
    return 'unavailable';
  }
});

export const loadBooking = cache(async (id: string): Promise<AdminBooking | Missing> => {
  try {
    const { data, response } = await getAdminBooking({ ...(await request()), path: { id } });
    return data ?? missing(response?.status);
  } catch {
    return 'unavailable';
  }
});

export const loadPayments = cache(async (): Promise<AdminPayments | Missing> => {
  try {
    const { data, response } = await getAdminPayments(await request());
    return data ?? missing(response?.status);
  } catch {
    return 'unavailable';
  }
});

export const loadOverstays = cache(
  async (
    status: AdminOverstaysQuery['status'],
    after: string | undefined,
  ): Promise<AdminOverstays | Missing> => {
    try {
      const { data, response } = await getAdminOverstays({
        ...(await request()),
        query: { status, after },
      });
      return data ?? missing(response?.status);
    } catch {
      return 'unavailable';
    }
  },
);

export const loadOverstay = cache(async (id: string): Promise<AdminOverstay | Missing> => {
  try {
    const { data, response } = await getAdminOverstay({ ...(await request()), path: { id } });
    return data ?? missing(response?.status);
  } catch {
    return 'unavailable';
  }
});

export const loadAudit = cache(
  async (
    action: AdminAuditQuery['action'],
    after: string | undefined,
  ): Promise<AuditLog | Missing> => {
    try {
      const { data, response } = await getAuditLog({
        ...(await request()),
        query: { action, after },
      });
      return data ?? missing(response?.status);
    } catch {
      return 'unavailable';
    }
  },
);
