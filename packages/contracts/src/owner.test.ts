import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOURS_EXCEPTION_LABEL_MAX,
  isAdult,
  isValidAfm,
  ListingHoursExceptionsCopyInputSchema,
  ListingHoursExceptionsInputSchema,
  ListingHoursInputSchema,
  ListingLocationInputSchema,
  ListingLocationPatchSchema,
  ListingPhotoUpdateSchema,
  ListingPricesInputSchema,
  ListingSpacesInputSchema,
  ListingSubmitInputSchema,
  LISTING_MILESTONES,
  LISTING_SPACES_MAX,
  LISTING_STEPS,
  OWNER_LISTINGS_MAX,
  OwnerProfileInputSchema,
  OwnerProfilePatchSchema,
  OwnerTaxInputSchema,
  wallMinutes,
} from './owner.js';
import { photoUrl } from './parking.js';
import { addDays } from './time.js';
import {
  HOURS_EXCEPTION_AHEAD_DAYS,
  HOURS_EXCEPTIONS_MAX,
  VALIDATION_MESSAGES,
} from './validation.js';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('isValidAfm', () => {
  it.each(['094259216', '090000045'])('accepts %s', (afm) => {
    expect(isValidAfm(afm)).toBe(true);
  });

  it.each(['123456789', '000000000', '09425921', '0942592160', '09425921a', ''])(
    'refuses %j',
    (afm) => {
      expect(isValidAfm(afm)).toBe(false);
    },
  );
});

describe('isAdult', () => {
  const today = new Date('2027-06-10T12:00:00Z');

  it('accepts someone 18 today, and refuses someone 18 tomorrow', () => {
    expect(isAdult('2009-06-10', today)).toBe(true);
    expect(isAdult('2009-06-11', today)).toBe(false);
  });
});

describe('OwnerProfileInputSchema', () => {
  const individual = {
    kind: 'individual',
    firstName: 'Μαρία',
    lastName: 'Παπαδοπούλου',
    phone: '+30 210 123 4567',
    addressLine: 'Ερμού 1',
    city: 'Αθήνα',
    postalCode: '105 63',
    country: 'GR',
  };

  it('accepts an individual with a name', () => {
    expect(OwnerProfileInputSchema.safeParse(individual).success).toBe(true);
  });

  it('asks individuals for both names', () => {
    const result = OwnerProfileInputSchema.safeParse({ ...individual, lastName: '  ' });
    expect(messages(result)).toEqual(['lastNameRequired']);
  });

  it('asks businesses for a legal name, not a person’s', () => {
    const business = { ...individual, kind: 'business', firstName: null, lastName: null };
    expect(messages(OwnerProfileInputSchema.safeParse(business))).toEqual(['legalNameRequired']);
    expect(
      OwnerProfileInputSchema.safeParse({ ...business, legalName: 'Πάρκινγκ ΑΕ' }).success,
    ).toBe(true);
  });

  it('needs the kind to be chosen', () => {
    const { kind: _kind, ...rest } = individual;
    expect(messages(OwnerProfileInputSchema.safeParse(rest))).toEqual(['ownerKindRequired']);
  });

  it.each(['abc', '12', '+', '+30 210 ABC 4567'])('refuses the phone number %j', (phone) => {
    expect(messages(OwnerProfileInputSchema.safeParse({ ...individual, phone }))).toEqual([
      'phoneInvalid',
    ]);
  });

  it('refuses a country outside the list', () => {
    expect(messages(OwnerProfileInputSchema.safeParse({ ...individual, country: 'US' }))).toEqual([
      'countryRequired',
    ]);
  });
});

describe('OwnerProfilePatchSchema', () => {
  it('takes one field at a time', () => {
    expect(OwnerProfilePatchSchema.parse({ phone: '+30 210 000 0000' })).toEqual({
      phone: '+30 210 000 0000',
    });
  });

  it('turns an empty field into a cleared one', () => {
    expect(OwnerProfilePatchSchema.parse({ phone: '' })).toEqual({ phone: null });
  });

  it('refuses fields a client must never set', () => {
    for (const field of ['verification', 'userId', 'taxIdEncrypted', 'reminderSentAt']) {
      expect(OwnerProfilePatchSchema.safeParse({ [field]: 'x' }).success, field).toBe(false);
    }
  });
});

describe('OwnerTaxInputSchema', () => {
  it('leaves empty fields out, so saved values stay', () => {
    expect(
      OwnerTaxInputSchema.parse({ taxCountry: 'GR', taxId: '', vatId: '', birthDate: '' }),
    ).toEqual({ taxCountry: 'GR' });
  });

  it('checks a Greek number’s check digit, ignoring spaces and dots', () => {
    const check = (taxId: string) => OwnerTaxInputSchema.safeParse({ taxCountry: 'GR', taxId });
    expect(check('094 259 216').success).toBe(true);
    expect(check('094.259.216').success).toBe(true);
    expect(messages(check('123456789'))).toEqual(['afmInvalid']);
  });

  it('leaves other countries’ numbers to their format', () => {
    expect(OwnerTaxInputSchema.safeParse({ taxCountry: 'CY', taxId: 'CY12345678L' }).success).toBe(
      true,
    );
  });

  it('refuses a real date for someone under 18', () => {
    const recent = `${new Date().getFullYear() - 10}-01-01`;
    expect(
      messages(OwnerTaxInputSchema.safeParse({ taxCountry: 'GR', birthDate: recent })),
    ).toEqual(['birthDateUnderage']);
  });

  it('refuses a date that doesn’t exist', () => {
    expect(
      messages(OwnerTaxInputSchema.safeParse({ taxCountry: 'GR', birthDate: '1980-02-31' })),
    ).toEqual(['birthDateInvalid']);
  });
});

describe('location', () => {
  const location = {
    name: 'Γκαράζ',
    address: 'Ερμού 1',
    areaId: 'syntagma',
    latitude: 37.97,
    longitude: 23.73,
    contentLocale: 'el',
  };

  it('accepts a point in Greece', () => {
    expect(ListingLocationInputSchema.safeParse(location).success).toBe(true);
  });

  it('accepts the far corners of the country', () => {
    const rhodes = { ...location, latitude: 36.43, longitude: 28.22 };
    const corfu = { ...location, latitude: 39.62, longitude: 19.92 };
    expect(ListingLocationInputSchema.safeParse(rhodes).success).toBe(true);
    expect(ListingLocationInputSchema.safeParse(corfu).success).toBe(true);
  });

  it('refuses a point abroad', () => {
    const berlin = { ...location, latitude: 52.5, longitude: 13.4 };
    expect(messages(ListingLocationInputSchema.safeParse(berlin))).toEqual(['outsideGreece']);
  });

  it('needs both halves of a pin in a patch', () => {
    expect(messages(ListingLocationPatchSchema.safeParse({ latitude: 37.9 }))).toEqual([
      'pinRequired',
    ]);
    expect(ListingLocationPatchSchema.safeParse({ latitude: null, longitude: null }).success).toBe(
      true,
    );
  });

  it('refuses a patched point abroad, and unknown fields', () => {
    expect(
      messages(ListingLocationPatchSchema.safeParse({ latitude: 52.5, longitude: 13.4 })),
    ).toEqual(['outsideGreece']);
    expect(ListingLocationPatchSchema.safeParse({ status: 'published' }).success).toBe(false);
    expect(ListingLocationPatchSchema.safeParse({ ownerId: 'x' }).success).toBe(false);
    expect(ListingLocationPatchSchema.safeParse({ slug: 'x' }).success).toBe(false);
  });
});

describe('spaces', () => {
  const space = (label: string) => ({ label, features: [], hourlyRateMinor: null });

  it('needs at least one', () => {
    expect(messages(ListingSpacesInputSchema.safeParse({ spaces: [] }))).toEqual([
      'spacesRequired',
    ]);
  });

  it('caps a listing’s spaces', () => {
    const many = Array.from({ length: LISTING_SPACES_MAX + 1 }, (_, i) => space(`S${i}`));
    expect(messages(ListingSpacesInputSchema.safeParse({ spaces: many }))).toEqual([
      'tooManySpaces',
    ]);
  });

  it('refuses a label used twice, however it is cased or padded', () => {
    const result = ListingSpacesInputSchema.safeParse({ spaces: [space('a1'), space(' A1 ')] });
    expect(messages(result)).toEqual(['spaceLabelDuplicate']);
    expect(result.error?.issues[0]?.path).toEqual(['spaces', 1, 'label']);
  });

  it('refuses a rate of nothing', () => {
    const free = { ...space('A1'), hourlyRateMinor: 0 };
    expect(messages(ListingSpacesInputSchema.safeParse({ spaces: [free] }))).toEqual([
      'rateInvalid',
    ]);
  });
});

describe('opening hours', () => {
  const check = (periods: object[]) => ListingHoursInputSchema.safeParse({ periods });

  it('reads wall times as minutes', () => {
    expect(wallMinutes('00:00')).toBe(0);
    expect(wallMinutes('08:30')).toBe(510);
    expect(wallMinutes('24:00')).toBe(1440);
  });

  it('needs at least one period', () => {
    expect(messages(check([]))).toEqual(['hoursRequired']);
  });

  it('allows touching periods but not overlapping ones', () => {
    const first = { weekday: 1, opens: '08:00', closes: '12:00' };
    expect(check([first, { weekday: 1, opens: '12:00', closes: '16:00' }]).success).toBe(true);
    expect(messages(check([first, { weekday: 1, opens: '11:30', closes: '16:00' }]))).toEqual([
      'hoursOverlap',
    ]);
    expect(check([first, { weekday: 2, opens: '11:30', closes: '16:00' }]).success).toBe(true);
  });

  it('needs closing after opening, on the half hour', () => {
    expect(messages(check([{ weekday: 1, opens: '12:00', closes: '08:00' }]))).toEqual([
      'hoursOrder',
    ]);
    expect(messages(check([{ weekday: 1, opens: '08:15', closes: '12:00' }]))).toEqual([
      'timeNotOnStep',
    ]);
  });
});

describe('prices', () => {
  const prices = {
    hourlyRateMinor: 300,
    dailyMaxMinor: 2000,
    bookingGapMinutes: 0,
    cancellationPolicy: 'oneDay',
    weekendRateMinor: null,
    night: null,
    datedPrices: [],
    longStayDiscounts: [],
  };
  const check = (change: object) => ListingPricesInputSchema.safeParse({ ...prices, ...change });
  const dated = (startsOn: string, endsOn: string) => ({
    label: null,
    startsOn,
    endsOn,
    rateMinor: 500,
  });

  it('accepts the simplest listing', () => {
    expect(check({ dailyMaxMinor: null }).success).toBe(true);
  });

  it('holds amounts between 10 cents and 1,000 euros', () => {
    expect(check({ hourlyRateMinor: 10, dailyMaxMinor: null }).success).toBe(true);
    expect(messages(check({ hourlyRateMinor: 9, dailyMaxMinor: null }))).toEqual(['rateInvalid']);
    expect(messages(check({ dailyMaxMinor: 100_001 }))).toEqual(['rateInvalid']);
  });

  it('never accepts a fraction of a cent', () => {
    expect(messages(check({ hourlyRateMinor: 3.5 }))).toEqual(['rateInvalid']);
  });

  it('needs the cap at or above the hourly rate', () => {
    expect(check({ dailyMaxMinor: 300 }).success).toBe(true);
    expect(messages(check({ dailyMaxMinor: 299 }))).toEqual(['dailyMaxBelowRate']);
  });

  it('allows only the gaps on offer', () => {
    expect(check({ bookingGapMinutes: 30 }).success).toBe(true);
    expect(check({ bookingGapMinutes: 45 }).success).toBe(false);
  });

  it('needs a policy from the list', () => {
    expect(messages(check({ cancellationPolicy: null }))).toEqual(['policyRequired']);
    expect(messages(check({ cancellationPolicy: 'never' }))).toEqual(['policyRequired']);
  });

  it('needs a night with a real window', () => {
    const night = { rateMinor: 100, from: '22:00', to: '22:00' };
    expect(messages(check({ night }))).toEqual(['nightWindowInvalid']);
    expect(check({ night: { ...night, to: '06:00' } }).success).toBe(true);
  });

  it('refuses dates backwards, and dates that overlap', () => {
    expect(messages(check({ datedPrices: [dated('2027-08-16', '2027-08-14')] }))).toEqual([
      'dateRangeInvalid',
    ]);
    expect(
      messages(
        check({
          datedPrices: [dated('2027-08-14', '2027-08-16'), dated('2027-08-16', '2027-08-18')],
        }),
      ),
    ).toEqual(['datedOverlap']);
    expect(
      check({ datedPrices: [dated('2027-08-14', '2027-08-15'), dated('2027-08-16', '2027-08-18')] })
        .success,
    ).toBe(true);
  });

  it('points an overlap at the row the owner sees it on', () => {
    const result = check({
      datedPrices: [dated('2027-12-01', '2027-12-02'), dated('2027-08-14', '2027-12-01')],
    });
    expect(result.error?.issues[0]?.path).toEqual(['datedPrices', 0, 'startsOn']);
  });

  it('keeps discounts sensible and unique', () => {
    const discount = (minDays: number, percent: number) => ({ minDays, percent });
    expect(check({ longStayDiscounts: [discount(7, 10)] }).success).toBe(true);
    expect(messages(check({ longStayDiscounts: [discount(7, 95)] }))).toEqual(['discountInvalid']);
    expect(messages(check({ longStayDiscounts: [discount(31, 10)] }))).toEqual(['discountInvalid']);
    expect(messages(check({ longStayDiscounts: [discount(7, 10), discount(7, 20)] }))).toEqual([
      'discountDuplicate',
    ]);
  });
});

describe('closures and special hours', () => {
  // Midday in Athens on 10 March 2027 (UTC+2 until the end of the month).
  const TODAY = '2027-03-10';
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-10T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const entry = (
    startsOn: string,
    endsOn = startsOn,
    hours: { opens: string; closes: string } | null = null,
    closedHours: { from: string; to: string } | null = null,
  ) => ({ label: null, startsOn, endsOn, hours, closedHours });
  const check = (...exceptions: object[]) =>
    ListingHoursExceptionsInputSchema.safeParse({ exceptions });
  const paths = (result: ReturnType<typeof check>) =>
    result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

  it('accepts none, a closed day, and a range with other hours', () => {
    expect(check().success).toBe(true);
    expect(check(entry('2027-12-25')).success).toBe(true);
    expect(
      check({
        ...entry('2027-12-24', '2027-12-31', { opens: '08:00', closes: '14:00' }),
        label: 'Γιορτές',
      }).success,
    ).toBe(true);
  });

  it('keeps an entry that ends today, and one that started before it', () => {
    expect(check(entry(TODAY)).success).toBe(true);
    expect(check(entry('2027-03-01', TODAY)).success).toBe(true);
  });

  it('refuses an entry that has ended, read on the Athens calendar', () => {
    expect(messages(check(entry('2027-03-09')))).toEqual(['dateInPast']);
    // 00:30 on the 10th in Athens, still the 9th in UTC.
    vi.setSystemTime(new Date('2027-03-09T22:30:00Z'));
    expect(messages(check(entry('2027-03-09')))).toEqual(['dateInPast']);
  });

  it('refuses dates backwards, on the end the owner set', () => {
    const result = check(entry('2027-12-26', '2027-12-25'));
    expect(messages(result)).toEqual(['lastDayBeforeFirst']);
    expect(paths(result)).toEqual(['exceptions.0.endsOn']);
  });

  it('reaches as far as a stay can, and no further', () => {
    const latest = addDays(TODAY, HOURS_EXCEPTION_AHEAD_DAYS);
    expect(check(entry(latest)).success).toBe(true);
    expect(messages(check(entry(addDays(latest, 1))))).toEqual(['dateTooFar']);
    expect(messages(check(entry(TODAY, addDays(latest, 1))))).toEqual(['dateTooFar']);
  });

  it('asks for a date where there is none, or none that exists, without a second message', () => {
    expect(messages(check(entry('2027-12-01', '2027-02-30')))).toEqual(['dateRequired']);
    expect(paths(check(entry('2027-02-30', '2027-12-01')))).toEqual(['exceptions.0.startsOn']);
    expect(messages(check(entry('')))).toEqual(['dateRequired', 'dateRequired']);
  });

  it('keeps a first day long past while the entry runs, but not one from another age', () => {
    const earliest = addDays(TODAY, -2 * HOURS_EXCEPTION_AHEAD_DAYS);
    expect(check(entry(earliest, TODAY)).success).toBe(true);
    const ancient = check(entry(addDays(earliest, -1), TODAY));
    expect(messages(ancient)).toEqual(['dateInPast']);
    expect(paths(ancient)).toEqual(['exceptions.0.startsOn']);
    // Postgres can't store year 0, so this must never reach it.
    expect(check(entry('0000-01-01', TODAY)).success).toBe(false);
  });

  it('opens before it closes, on the half hour, by midnight', () => {
    const hours = (opens: string, closes: string) =>
      check(entry('2027-12-24', '2027-12-24', { opens, closes }));
    expect(hours('08:00', '24:00').success).toBe(true);
    expect(hours('00:00', '00:30').success).toBe(true);
    expect(messages(hours('14:00', '08:00'))).toEqual(['hoursOrder']);
    expect(paths(hours('14:00', '14:00'))).toEqual(['exceptions.0.hours.closes']);
    expect(messages(hours('08:15', '14:00'))).toEqual(['timeNotOnStep']);
    expect(hours('24:00', '24:00').success).toBe(false);
  });

  it('closes part of a day, the right way round and by midnight', () => {
    const part = (from: string, to: string) =>
      check(entry('2027-12-24', '2027-12-24', null, { from, to }));
    expect(part('10:00', '14:00').success).toBe(true);
    expect(part('20:00', '24:00').success).toBe(true);
    expect(messages(part('14:00', '10:00'))).toEqual(['closedTimeOrder']);
    expect(paths(part('14:00', '14:00'))).toEqual(['exceptions.0.closedHours.to']);
    expect(messages(part('10:10', '14:00'))).toEqual(['timeNotOnStep']);
  });

  it('never takes other hours and a closed part for the same days', () => {
    const both = check(
      entry(
        '2027-12-24',
        '2027-12-24',
        { opens: '08:00', closes: '14:00' },
        { from: '10:00', to: '11:00' },
      ),
    );
    expect(messages(both)).toEqual(['invalid']);
    expect(paths(both)).toEqual(['exceptions.0.closedHours']);
  });

  it('names every entry that shares a day with another, wherever it sits in the list', () => {
    const long = entry('2027-12-20', '2027-12-31');
    const result = check(entry('2027-12-28'), long, entry('2027-12-22', '2027-12-23'));
    expect(paths(result)).toEqual(['exceptions.2.startsOn', 'exceptions.0.startsOn']);
    expect(new Set(messages(result))).toEqual(new Set(['exceptionOverlap']));
    expect(messages(check(entry('2027-12-24', '2027-12-25'), entry('2027-12-25')))).toEqual([
      'exceptionOverlap',
    ]);
    expect(check(entry('2027-12-24'), entry('2027-12-25')).success).toBe(true);
  });

  it('caps the list, the note and what the note may hold', () => {
    const many = Array.from({ length: HOURS_EXCEPTIONS_MAX + 1 }, (_, day) =>
      entry(addDays('2027-04-01', day)),
    );
    expect(messages(check(...many))).toEqual(['invalid']);
    expect(check(...many.slice(1)).success).toBe(true);
    const label = (text: string) => check({ ...entry('2027-12-25'), label: text });
    expect(label('x'.repeat(HOURS_EXCEPTION_LABEL_MAX)).success).toBe(true);
    expect(messages(label('x'.repeat(HOURS_EXCEPTION_LABEL_MAX + 1)))).toEqual(['textTooLong']);
    expect(messages(label('Χριστούγεννα\u0000'))).toEqual(['invalid']);
    expect(label('  Χριστούγεννα  ').data?.exceptions[0]?.label).toBe('Χριστούγεννα');
  });

  it('takes nothing it does not know, and no list that is not one', () => {
    expect(
      ListingHoursExceptionsInputSchema.safeParse({ exceptions: [], locationId: 'x' }).success,
    ).toBe(false);
    expect(ListingHoursExceptionsInputSchema.safeParse({ exceptions: 'all' }).success).toBe(false);
    expect(ListingHoursExceptionsInputSchema.safeParse({}).success).toBe(false);
  });

  it('says which way round the dates are wrong, not just that they are', () => {
    expect(paths(check(entry('2027-12-26', '2027-12-25')))).toEqual(['exceptions.0.endsOn']);
  });

  it('only ever says what the catalogs can translate', () => {
    const result = check(entry('2027-03-01'), entry('2027-12-26', '2027-12-25'));
    for (const text of messages(result)) {
      expect(VALIDATION_MESSAGES).toContain(text);
    }
  });
});

describe('the rest', () => {
  it('needs the box ticked to submit', () => {
    expect(ListingSubmitInputSchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(messages(ListingSubmitInputSchema.safeParse({ confirmed: false }))).toEqual([
      'confirmRequired',
    ]);
  });

  it('turns an empty description into a cleared one', () => {
    expect(ListingPhotoUpdateSchema.parse({ alt: '' })).toEqual({ alt: null });
  });

  it('builds a same-origin photo address', () => {
    expect(photoUrl('a'.repeat(32), 480)).toBe(`/api/v1/media/photos/${'a'.repeat(32)}/480.webp`);
  });

  it('puts every step in exactly one milestone', () => {
    const inMilestones = LISTING_MILESTONES.flatMap((milestone) => [...milestone.steps]);
    expect([...inMilestones].sort()).toEqual([...LISTING_STEPS].sort());
  });

  it('keeps every validation key unique', () => {
    expect(new Set(VALIDATION_MESSAGES).size).toBe(VALIDATION_MESSAGES.length);
  });
});

describe('copying closures to other listings', () => {
  const ids = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
  const copy = (body: unknown) => ListingHoursExceptionsCopyInputSchema.safeParse(body);

  it('takes from one listing up to as many as an owner can have', () => {
    expect(copy({ to: ids(1) }).success).toBe(true);
    expect(copy({ to: ids(OWNER_LISTINGS_MAX) }).success).toBe(true);
    expect(messages(copy({ to: ids(OWNER_LISTINGS_MAX + 1) }))).toEqual(['invalid']);
    expect(messages(copy({ to: [] }))).toEqual(['invalid']);
  });

  it('takes each listing once, and only ids', () => {
    const [one = ''] = ids(1);
    expect(copy({ to: [one, one] }).success).toBe(false);
    expect(copy({ to: ['not-an-id'] }).success).toBe(false);
  });

  it('takes nothing else, so no other field can steer it', () => {
    expect(copy({ to: ids(1), from: ids(1)[0] }).success).toBe(false);
    expect(copy({}).success).toBe(false);
  });
});
