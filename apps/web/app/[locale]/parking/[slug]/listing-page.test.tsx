import {
  addDays,
  DEFAULT_TIME_ZONE,
  type ParkingListingDetail,
  zonedParts,
} from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadListing } from '@/lib/api.server';
import { loadFavouriteState, loadVehicles } from '@/lib/bookings.server';
import { getLayoutSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import ListingPage from './page';

vi.mock('@/lib/api.server', () => ({ loadListing: vi.fn() }));
vi.mock('@/lib/bookings.server', () => ({
  loadVehicles: vi.fn(() => Promise.resolve([])),
  loadFavouriteState: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('@/lib/session', () => ({ getLayoutSession: vi.fn() }));
vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  holdParkingSpace: vi.fn(),
  favouriteListing: vi.fn(),
  unfavouriteListing: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator, createFormatter }, en] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
  ]);
  return {
    getTranslations: ({ namespace }: { namespace: string }) =>
      Promise.resolve(
        createTranslator({ locale: 'en', messages: en.default, namespace: namespace as never }),
      ),
    getFormatter: () =>
      Promise.resolve(createFormatter({ locale: 'en', timeZone: 'Europe/Athens' })),
  };
});

// A few days out, inside every limit a stay has.
const day = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 3);
const windowParams = { startDate: day, startTime: '10:00', endDate: day, endTime: '12:00' };
const money = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });
const space = (id: string, label: string, total: number) => ({
  id,
  label,
  features: [],
  maxHeightCm: null,
  maxLengthCm: null,
  maxWidthCm: null,
  hourlyRate: money(200),
  total: money(total),
});

const listing = (overrides: Partial<ParkingListingDetail> = {}): ParkingListingDetail => ({
  slug: 'ermou-garage',
  name: 'Γκαράζ Ερμού',
  address: 'Ερμού 1, Αθήνα',
  area: 'syntagma',
  contentLocale: 'el',
  hourlyRate: money(200),
  dailyMax: null,
  spacePricesVary: true,
  features: [],
  security: [],
  spaceCount: 3,
  coverPhoto: null,
  description: null,
  latitude: 37.97,
  longitude: 23.73,
  timeZone: 'Europe/Athens',
  openingHours: [],
  hoursExceptions: [],
  spaces: [
    space('22222222-2222-4222-8222-222222222222', 'Α2', 800),
    space('11111111-1111-4111-8111-111111111111', 'Α1', 400),
  ],
  photos: [],
  priceRules: { weekendRate: null, night: null, dated: [], longStay: [] },
  cancellationPolicy: 'oneDay',
  availability: {
    start: '2099-01-01T08:00:00.000Z',
    end: '2099-01-01T10:00:00.000Z',
    open: true,
    freeSpaces: 2,
    total: money(400),
  },
  bookingOpen: true,
  ...overrides,
});

async function show(
  found: ParkingListingDetail,
  signedIn: boolean,
  params: Record<string, string> = windowParams,
) {
  vi.mocked(loadListing).mockResolvedValue(found);
  vi.mocked(getLayoutSession).mockResolvedValue(
    (signedIn ? { user: { id: 'u' } } : null) as Awaited<ReturnType<typeof getLayoutSession>>,
  );
  return renderWithProviders(
    await ListingPage({
      params: Promise.resolve({ locale: 'en', slug: 'ermou-garage' }),
      searchParams: Promise.resolve(params),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the listing page’s booking', () => {
  it('offers a signed-in driver the free spaces, the cheapest picked', async () => {
    await show(listing(), true);
    expect(screen.getByRole('heading', { level: 2, name: 'Choose your space' })).toBeVisible();
    expect(screen.getByText('2 of the 3 spaces are free for your stay.')).toBeInTheDocument();
    // A bundle of its own (`BookSpacePicker`): the first load transforms it.
    expect(await screen.findByRole('radio', { name: 'Α1' }, { timeout: 10_000 })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Α2' })).toHaveAccessibleDescription(
      '€8.00 for your stay',
    );
    expect(screen.getByRole('button', { name: 'Book this space' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose your space to book it.' })).toHaveAttribute(
      'href',
      '#spaces',
    );
  });

  it('asks anyone signed out to sign in, and brings them back to this stay (decision #8)', async () => {
    const { container } = await show(listing(), false);
    await expectNoAxeViolations(container);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: 'Sign in to book' });
    const next = new URL(signIn.getAttribute('href') ?? '', 'http://x').searchParams.get('next');
    expect(next).toBe(
      `/parking/ermou-garage?startDate=${day}&startTime=10%3A00&endDate=${day}&endTime=12%3A00`,
    );
  });

  it('says the space went when a driver lets it go, where they choose another', async () => {
    const { container } = await show(listing(), true, { ...windowParams, released: '1' });
    const notice = screen.getByRole('heading', { level: 2, name: 'You let the space go' });
    expect(notice.closest('section')).toHaveAttribute('id', 'spaces');
    expect(screen.getByText(/Choose a space below, or other times/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('says nothing of it on an ordinary visit', async () => {
    await show(listing(), true);
    expect(screen.queryByRole('heading', { name: 'You let the space go' })).not.toBeInTheDocument();
  });

  it('says booking is coming where it can’t be taken yet (decision #33)', async () => {
    await show(listing({ bookingOpen: false }), true);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in to book' })).not.toBeInTheDocument();
    expect(screen.getByText('This parking can’t be booked online yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Spaces' })).toBeVisible();
  });

  it('offers nothing to book when the listing is closed for the stay', async () => {
    const availability = listing().availability;
    if (!availability) throw new Error('fixture');
    await show(listing({ availability: { ...availability, open: false }, spaces: [] }), true);
    expect(screen.queryByRole('button', { name: 'Book this space' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Spaces' })).toBeVisible();
    // Nothing is asked of the API for the booking form, which isn't shown.
    expect(loadVehicles).not.toHaveBeenCalled();
  });

  it('says none is free when it is full, and keeps the place where a refusal shows', async () => {
    const availability = listing().availability;
    if (!availability) throw new Error('fixture');
    const full = listing({ availability: { ...availability, freeSpaces: 0 }, spaces: [] });
    await show(full, true);
    expect(screen.getByText('None of the 3 spaces is free for your stay.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book this space' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Choose your space' })).not.toBeInTheDocument();
    await show(full, false);
    expect(screen.queryByRole('link', { name: 'Sign in to book' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /to book it/ })).not.toBeInTheDocument();
    // The booked spaces aren't "more" spaces.
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('shows the listing’s security, and each space’s limits where there are some (5A.1)', async () => {
    const sized = listing({
      security: ['lit', 'gated'],
      spaces: [
        { ...space('11111111-1111-4111-8111-111111111111', 'Α1', 400), maxHeightCm: 190 },
        space('22222222-2222-4222-8222-222222222222', 'Α2', 800),
      ],
      availability: null,
    });
    await show(sized, true, {} as typeof windowParams);
    expect(screen.getByRole('list', { name: 'Security' })).toHaveTextContent('Lit at night');
    const spaces = screen.getByRole('list', { name: 'Spaces' });
    const item = (label: string) =>
      within(spaces)
        .getAllByRole('listitem')
        .find((entry) => entry.textContent?.includes(label));
    expect(item('Α1')).toHaveTextContent('Vehicles up to 190 cm high');
    // No limit given: nothing said, rather than that any size will do.
    expect(item('Α2')).not.toHaveTextContent('cm');
  });

  it('shows the spaces as before when no stay is chosen', async () => {
    await show(listing({ availability: null }), true, {} as typeof windowParams);
    const spaces = screen.getByRole('list', { name: 'Spaces' });
    expect(within(spaces).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('a signed-in driver’s own things on the listing page (5A.2)', () => {
  it('offers the favourite button, pressed when it is one, and nothing to a visitor', async () => {
    vi.mocked(loadFavouriteState).mockResolvedValueOnce(true);
    const signedIn = await show(listing(), true);
    expect(await screen.findByRole('button', { name: 'Favourite', pressed: true })).toBeVisible();
    expect(loadFavouriteState).toHaveBeenCalledWith('ermou-garage');
    signedIn.unmount();
    await show(listing(), false);
    expect(screen.queryByRole('button', { name: 'Favourite' })).not.toBeInTheDocument();
    expect(loadFavouriteState).toHaveBeenCalledTimes(1);
  });

  it('leaves the button out when the API could not say, rather than guessing', async () => {
    vi.mocked(loadFavouriteState).mockResolvedValueOnce(null);
    await show(listing(), true);
    expect(screen.queryByRole('button', { name: 'Favourite' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Choose your space' })).toBeVisible();
  });

  it('asks which vehicle, and says which spaces are too small for it', async () => {
    vi.mocked(loadVehicles).mockResolvedValueOnce([
      {
        id: 'a0a0a0a0-0000-4000-8000-000000000001',
        plate: 'IKB1234',
        name: 'Work car',
        heightCm: 210,
        lengthCm: null,
        widthCm: null,
      },
    ]);
    const sized = listing({
      spaces: [
        { ...space('11111111-1111-4111-8111-111111111111', 'Α1', 400), maxHeightCm: 190 },
        space('22222222-2222-4222-8222-222222222222', 'Α2', 800),
      ],
    });
    await show(sized, true);
    const picker = await screen.findByRole('combobox', { name: 'Vehicle' }, { timeout: 10_000 });
    expect(picker).toHaveValue('a0a0a0a0-0000-4000-8000-000000000001');
    expect(screen.getByRole('option', { name: 'Work car · IKB1234' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveAccessibleDescription(
      /Too small for this vehicle/,
    );
    expect(screen.getByRole('radio', { name: 'Α2' })).not.toHaveAccessibleDescription(/Too small/);
  });

  it('shows no vehicle choice to a driver who has saved none', async () => {
    await show(listing(), true);
    await screen.findByRole('radio', { name: 'Α1' }, { timeout: 10_000 });
    expect(screen.queryByRole('combobox', { name: 'Vehicle' })).not.toBeInTheDocument();
  });
});

describe('an English listing with Greek words in it', () => {
  const english = listing({
    name: 'Garage by Πλατεία Κλαυθμώνος',
    contentLocale: 'en',
    description: 'Enter from Σταδίου street; the gate opens at 7.',
    spaces: [
      space('22222222-2222-4222-8222-222222222222', 'Α2', 800),
      space('11111111-1111-4111-8111-111111111111', 'B1', 400),
    ],
  });
  const marked = (text: string, within: HTMLElement = document.body) =>
    Array.from(within.querySelectorAll('[lang="el"]')).filter(
      (element) => element.textContent === text,
    );

  it('marks them in the description and the spaces to choose from', async () => {
    const { container } = await show(english, true);
    const about = screen.getByRole('region', { name: 'About this parking' });
    const street = within(about).getByText('Σταδίου');
    expect(street).toHaveAttribute('lang', 'el');
    expect(street.parentElement).toHaveAttribute('lang', 'en');
    expect(within(about).getByText(/^Enter from/)).toHaveTextContent(
      'Enter from Σταδίου street; the gate opens at 7.',
    );
    // A Greek alpha in a space's label, and a Latin B left alone.
    const choice = screen.getByRole('radio', { name: /^Α2/ });
    const label = choice.closest('label') ?? document.body;
    expect(marked('Α2', label)).toHaveLength(1);
    expect(marked('B1')).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('marks them in the list of spaces when no stay is chosen', async () => {
    await show({ ...english, availability: null }, true, {} as typeof windowParams);
    const spaces = screen.getByRole('list', { name: 'Spaces' });
    expect(marked('Α2', spaces)).toHaveLength(1);
    expect(marked('B1', spaces)).toHaveLength(0);
  });
});
