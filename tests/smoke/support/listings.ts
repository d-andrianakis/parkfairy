import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { WEB_URL } from './env';

const PHOTO = readFileSync(
  fileURLToPath(
    new URL('../../../apps/api/seed-assets/photos/ermou-parking-2.jpg', import.meta.url),
  ),
);
const WEEK = [1, 2, 3, 4, 5, 6, 7];

/** A calendar day in Athens, `days` from today. */
export function athensDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date());
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** An Athens wall-clock time as an instant, whichever side of a clock change it falls. */
export function athensInstant(day: string, time: string): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const offset of [2, 3]) {
    const guess = new Date(Date.parse(`${day}T${time}:00Z`) - offset * 3_600_000);
    if (local.format(guess) === `${day}, ${time}`) return guess.toISOString();
  }
  throw new Error(`No ${time} on ${day} in Athens`);
}

/**
 * Everything up to staff, through the API, for the owner signed in on `page`: the steps have
 * their own smoke test. Open all week at €2.00 an hour, with the spaces named, written in Greek
 * unless `contentLocale` says otherwise. Far from the demo areas, so no other test's search meets
 * it.
 */
export async function listingWithStaff(
  page: Page,
  name: string,
  {
    spaces = ['K1'],
    contentLocale = 'el',
  }: { spaces?: string[]; contentLocale?: 'el' | 'en' } = {},
): Promise<{ id: string; slug: string }> {
  const headers = { origin: WEB_URL };
  const call = async (method: 'patch' | 'put' | 'post', path: string, data: unknown) => {
    const response = await page.request[method](`/api/v1/owner${path}`, { headers, data });
    expect(response.ok(), `${method} ${path}`).toBe(true);
    return response;
  };
  await call('patch', '/profile', {
    kind: 'individual',
    firstName: 'Ελένη',
    lastName: 'Κλειδαριά',
    phone: '+30 210 123 4567',
    addressLine: 'Ερμού 1',
    city: 'Αθήνα',
    postalCode: '105 63',
    country: 'GR',
  });
  await call('put', '/profile/tax', {
    taxCountry: 'GR',
    taxId: '094259216',
    birthDate: '1980-02-03',
  });
  const { id } = (await (await call('post', '/listings', undefined)).json()) as { id: string };
  await call('patch', `/listings/${id}/location`, {
    name,
    address: 'Οδός Δοκιμής 1, Ηράκλειο',
    areaId: 'syntagma',
    latitude: 35.3387,
    longitude: 25.1442,
    contentLocale,
  });
  await call('put', `/listings/${id}/spaces`, {
    spaces: spaces.map((label) => ({ label, features: [], hourlyRateMinor: null })),
  });
  await call('put', `/listings/${id}/hours`, {
    periods: WEEK.map((weekday) => ({ weekday, opens: '00:00', closes: '24:00' })),
  });
  await call('put', `/listings/${id}/prices`, {
    hourlyRateMinor: 200,
    dailyMaxMinor: null,
    bookingGapMinutes: 0,
    cancellationPolicy: 'oneDay',
    weekendRateMinor: null,
    night: null,
    datedPrices: [],
    longStayDiscounts: [],
  });
  const photo = await page.request.post(`/api/v1/owner/listings/${id}/photos`, {
    headers: { ...headers, 'content-type': 'image/jpeg' },
    data: PHOTO,
  });
  expect(photo.status()).toBe(201);
  const proof = await page.request.post(`/api/v1/owner/listings/${id}/proofs?kind=lease`, {
    headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': 'lease.pdf' },
    data: Buffer.from('%PDF-1.7\n%smoke test document\n'),
  });
  expect(proof.status()).toBe(201);
  const submitted = await call('post', `/listings/${id}/submit`, { confirmed: true });
  return { id, slug: ((await submitted.json()) as { slug: string }).slug };
}
