import {
  addDays,
  DEFAULT_TIME_ZONE,
  zonedParts,
  type ParkingSearchResponse,
  type ParkingSearchResult,
} from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from '@/i18n/navigation';
import { loadSearchResults, lookupPlace } from '@/lib/api.server';
import { mapboxToken } from '@/lib/maps.server';
import { renderWithProviders } from '@/test/render';
import SearchPage, { generateMetadata } from './page';

vi.mock('@/lib/api.server', () => ({ loadSearchResults: vi.fn(), lookupPlace: vi.fn() }));
vi.mock('@/lib/maps.server', () => ({ mapboxToken: vi.fn() }));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(request.headers) }));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator, createFormatter }, en, el] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
    import('@/messages/el.json'),
  ]);
  const catalogs = { en: en.default, el: el.default };
  return {
    getTranslations: ({ locale, namespace }: { locale: 'en' | 'el'; namespace: string }) =>
      Promise.resolve(
        createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never }),
      ),
    getFormatter: ({ locale }: { locale: 'en' | 'el' }) =>
      Promise.resolve(createFormatter({ locale, timeZone: 'Europe/Athens' })),
  };
});

const day = addDays(zonedParts(new Date(), DEFAULT_TIME_ZONE).date, 3);
const stay = { startDate: day, startTime: '10:00', endDate: day, endTime: '12:00' };
const money = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });

const result = (
  slug: string,
  overrides: Partial<ParkingSearchResult> = {},
): ParkingSearchResult => ({
  slug,
  name: `Γκαράζ ${slug}`,
  address: 'Ερμού 10, Αθήνα',
  area: 'syntagma',
  contentLocale: 'el',
  hourlyRate: money(200),
  dailyMax: null,
  spacePricesVary: false,
  features: [],
  spaceCount: 3,
  coverPhoto: null,
  latitude: 37.976,
  longitude: 23.733,
  distanceMeters: 120,
  freeSpaces: 2,
  total: money(400),
  ...overrides,
});

function answer(results: ParkingSearchResult[]): ParkingSearchResponse {
  return { start: '2026-12-10T08:00:00.000Z', end: '2026-12-10T10:00:00.000Z', results };
}

async function show(params: Record<string, string>, locale: 'en' | 'el' = 'en') {
  const props = {
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(params),
  };
  const metadata = await generateMetadata(props);
  const view = renderWithProviders(await SearchPage(props), { locale });
  return { ...view, metadata };
}

beforeEach(() => {
  vi.clearAllMocks();
  request.headers = new Headers({ 'sec-fetch-site': 'same-origin' });
  vi.mocked(mapboxToken).mockReturnValue('pk.test');
  vi.mocked(loadSearchResults).mockResolvedValue(answer([]));
});

describe('a place typed or picked (decision #40)', () => {
  it('looks typed words up once and goes on to their position, keeping the stay and the language', async () => {
    vi.mocked(lookupPlace).mockResolvedValue({
      label: 'Ermou 10, Athens',
      latitude: 37.97654,
      longitude: 23.73321,
    });
    await show({ place: 'ermou 10', ...stay });
    expect(lookupPlace).toHaveBeenCalledWith('ermou 10', 'en');
    expect(redirect).toHaveBeenCalledWith({
      href: {
        pathname: '/search',
        query: {
          place: 'Ermou 10, Athens',
          placeLocale: 'en',
          latitude: '37.97654',
          longitude: '23.73321',
          ...stay,
        },
      },
      locale: 'en',
    });
    expect(loadSearchResults).not.toHaveBeenCalled();
  });

  it('says the address wasn’t found, linked to the field', async () => {
    vi.mocked(lookupPlace).mockResolvedValue('not-found');
    const { container, metadata } = await show({ place: 'Xyzzy', ...stay });
    expect(metadata.title).toMatch(/^Error: /);
    const summary = screen.getByRole('alert');
    expect(
      within(summary).getByRole('link', {
        name: 'Address or place: We couldn’t find that address or place. Check it, or choose an area',
      }),
    ).toHaveAttribute('href', '#search-place');
    expect(screen.getByRole('combobox', { name: 'Or type an address or place' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectNoAxeViolations(container);
  });

  it('says address search is unavailable when the look-up can’t be made', async () => {
    vi.mocked(lookupPlace).mockResolvedValue('unavailable');
    await show({ place: 'Ermou', ...stay });
    expect(screen.getByRole('alert')).toHaveTextContent(/Address search isn’t available right now/);
  });

  it('spends no look-up on a link from another site; the visitor presses Search', async () => {
    request.headers = new Headers({ 'sec-fetch-site': 'cross-site' });
    const { metadata } = await show({ place: 'Ermou', ...stay });
    expect(lookupPlace).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const asked = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' && element.textContent === 'Press “Search” to look for “Ermou”.',
    );
    expect(asked.querySelector('[lang="en"]')).toHaveTextContent('Ermou');
    expect(metadata.title).toBe('Search for parking');
  });

  it('asks for no look-up without a token, and asks where instead', async () => {
    vi.mocked(mapboxToken).mockReturnValue(null);
    await show({ place: 'Ermou', ...stay });
    expect(lookupPlace).not.toHaveBeenCalled();
    expect(within(screen.getByRole('alert')).getByRole('link')).toHaveAttribute(
      'href',
      '#search-area',
    );
  });

  it('names the place in the heading in the language Mapbox gave it', async () => {
    vi.mocked(loadSearchResults).mockResolvedValue(answer([result('a')]));
    const { metadata } = await show({
      place: 'Πλατεία Συντάγματος',
      placeLocale: 'el',
      latitude: '37.9755',
      longitude: '23.7348',
      ...stay,
    });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Parking near “Πλατεία Συντάγματος”');
    expect(heading.querySelector('[lang="el"]')).toHaveTextContent('Πλατεία Συντάγματος');
    expect(metadata.title).toBe('Parking near “Πλατεία Συντάγματος” – 1 place with free spaces');
    expect(loadSearchResults).toHaveBeenCalledWith(
      undefined,
      37.9755,
      23.7348,
      expect.any(String),
      expect.any(String),
    );
  });

  it('marks the Greek words of a place named on an English page', async () => {
    vi.mocked(loadSearchResults).mockResolvedValue(answer([result('a')]));
    const { container } = await show({
      place: 'Οδός Ερμού 10, Athens',
      placeLocale: 'en',
      latitude: '37.9755',
      longitude: '23.7348',
      ...stay,
    });
    const heading = screen.getByRole('heading', { level: 1 });
    const place = heading.querySelector('[lang="en"]');
    expect(place).toHaveTextContent('Οδός Ερμού 10, Athens');
    expect(place?.querySelector('[lang="el"]')).toHaveTextContent(/^Οδός Ερμού$/);
    await expectNoAxeViolations(container);
  });

  it('marks Greek words typed for a look-up the visitor must ask for, and none on a Greek page', async () => {
    request.headers = new Headers({ 'sec-fetch-site': 'cross-site' });
    const english = await show({ place: 'Πλατεία Συντάγματος', ...stay });
    const asked = screen.getByText(
      (_, element) => element?.tagName === 'P' && /Πλατεία Συντάγματος/.test(element.textContent),
    );
    expect(asked.querySelector('[lang="en"] [lang="el"]')).toHaveTextContent('Πλατεία Συντάγματος');
    english.unmount();
    request.headers = new Headers({ 'sec-fetch-site': 'same-origin' });
    vi.mocked(loadSearchResults).mockResolvedValue(answer([result('a')]));
    await show(
      {
        place: 'Πλατεία Συντάγματος',
        placeLocale: 'el',
        latitude: '37.9755',
        longitude: '23.7348',
        ...stay,
      },
      'el',
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.querySelector('[lang="el"]')).toHaveTextContent('Πλατεία Συντάγματος');
    expect(heading.querySelector('[lang="el"] [lang]')).toBeNull();
  });

  it('reads right in Greek', async () => {
    vi.mocked(loadSearchResults).mockResolvedValue(answer([result('a')]));
    const { container } = await show(
      { place: 'Ερμού 10', latitude: '37.9762', longitude: '23.7329', ...stay },
      'el',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Στάθμευση κοντά στο σημείο «Ερμού 10»',
    );
    await expectNoAxeViolations(container);
  });
});

describe('the results map (decision #41)', () => {
  const params = { area: 'syntagma', ...stay };

  it('offers the map and numbers the cards only with a token and results', async () => {
    vi.mocked(loadSearchResults).mockResolvedValue(answer([result('a'), result('b')]));
    const { unmount } = await show(params);
    expect(screen.getByRole('button', { name: 'Show the map' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '' });
    expect(list.tagName).toBe('OL');
    expect(list.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2);
    unmount();

    vi.mocked(mapboxToken).mockReturnValue(null);
    await show(params);
    expect(screen.queryByRole('button', { name: 'Show the map' })).not.toBeInTheDocument();
  });

  it('offers no map for no results', async () => {
    await show(params);
    expect(screen.queryByRole('button', { name: 'Show the map' })).not.toBeInTheDocument();
  });
});
