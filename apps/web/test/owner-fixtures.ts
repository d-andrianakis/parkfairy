import type { OwnerListing, OwnerListingProgress, OwnerProfile } from '@parkfairy/contracts';

export const LISTING_ID = '11111111-1111-4111-8111-111111111111';

export const profileFixture = (overrides: Partial<OwnerProfile> = {}): OwnerProfile => ({
  kind: null,
  firstName: null,
  lastName: null,
  legalName: null,
  phone: null,
  addressLine: null,
  city: null,
  postalCode: null,
  country: 'GR',
  verification: 'unverified',
  tax: {
    taxCountry: 'GR',
    taxIdEnding: null,
    vatIdEnding: null,
    registrationEnding: null,
    birthDateSaved: false,
  },
  ...overrides,
});

export const progressFixture = (
  overrides: Partial<OwnerListingProgress> = {},
): OwnerListingProgress => ({
  id: LISTING_ID,
  name: 'Γκαράζ Ερμού',
  contentLocale: 'el',
  status: 'draft',
  slug: null,
  coverPhoto: null,
  doneSteps: [],
  nextStep: 'location',
  reviewNote: null,
  submittedAt: null,
  updatedAt: '2027-01-01T00:00:00.000Z',
  ...overrides,
});

export const listingFixture = (overrides: Partial<OwnerListing> = {}): OwnerListing => ({
  id: LISTING_ID,
  status: 'draft',
  locked: false,
  progress: progressFixture(),
  doneAccountSteps: [],
  location: {
    name: null,
    address: null,
    areaId: null,
    latitude: null,
    longitude: null,
    description: null,
    contentLocale: 'el',
  },
  spaces: [],
  openingHours: [],
  prices: {
    hourlyRateMinor: null,
    dailyMaxMinor: null,
    bookingGapMinutes: 0,
    cancellationPolicy: null,
    weekendRateMinor: null,
    night: null,
    datedPrices: [],
    longStayDiscounts: [],
  },
  photos: [],
  proofs: [],
  landRegistrationNumber: null,
  ...overrides,
});

/** What the generated client resolves with: the shape `attempt` reads. */
export const answer = <T>(data: T) => ({ data, response: new Response(null, { status: 200 }) });
export const refusal = (code: string, status = 409, message?: string[]) => ({
  error: { code, statusCode: status, message: message ?? code },
  response: new Response(null, { status }),
});
