import type { ParkingListingSummary } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadFavourites } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import FavouritesPage, { generateMetadata } from './page';

vi.mock('@/lib/bookings.server', () => ({ loadFavourites: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/maps.server', () => ({ mapboxToken: vi.fn(() => null) }));
vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  favouriteListing: vi.fn(),
  unfavouriteListing: vi.fn(),
}));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator }, en, el] = await Promise.all([
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
  };
});

const listing = (slug: string, name: string): ParkingListingSummary => ({
  slug,
  name,
  address: 'Ερμού 1, Αθήνα',
  area: 'syntagma',
  contentLocale: 'el',
  hourlyRate: { amountMinor: 200, currency: 'EUR' },
  dailyMax: null,
  spacePricesVary: false,
  features: [],
  security: [],
  spaceCount: 3,
  coverPhoto: null,
});
const show = async (locale: 'en' | 'el' = 'en', removed?: string) =>
  renderWithProviders(
    await FavouritesPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve(removed ? { removed } : {}),
    }),
    { locale },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the favourites page (5A.2)', () => {
  it('needs the driver signed in', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([]);
    await show();
    expect(requireSession).toHaveBeenCalledWith('/favourites');
  });

  it('lists each favourite as a card with a way to let it go, named for the listing', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([
      listing('ermou-garage', 'Γκαράζ Ερμού'),
      listing('plaka-lot', 'Πάρκινγκ Πλάκας'),
    ]);
    const { container } = await show();
    const list = screen.getByRole('list', { name: 'Your favourite parking' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(
      within(items[0] as HTMLElement).getByRole('link', { name: 'Γκαράζ Ερμού' }),
    ).toHaveAttribute('href', '/en/parking/ermou-garage');
    const buttons = screen.getAllByRole('button', { name: 'Remove from favourites' });
    expect(buttons.map((button) => button.getAttribute('aria-describedby'))).toEqual([
      'favourite-name-ermou-garage',
      'favourite-name-plaka-lot',
    ]);
    expect(buttons[1]).toHaveAccessibleDescription('Πάρκινγκ Πλάκας');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('says there are none yet, and offers to look', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([]);
    await show();
    expect(screen.getByText(/You haven’t saved any parking yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find parking' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says when the API could not answer, rather than that there are none', async () => {
    vi.mocked(loadFavourites).mockResolvedValue(null);
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent('can’t load your favourites');
    expect(screen.queryByText(/haven’t saved/)).toBeNull();
  });

  it('says a favourite was let go, after the page’s heading, and takes the focus', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([]);
    await show('en', 'ermou-garage');
    const notice = screen.getByRole('heading', { level: 2, name: 'Removed from your favourites.' });
    await waitFor(() => expect(notice).toHaveFocus());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('says nothing of it on an ordinary visit', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([]);
    await show();
    expect(screen.queryByText('Removed from your favourites.')).toBeNull();
  });

  it('speaks Greek, and names the tab', async () => {
    vi.mocked(loadFavourites).mockResolvedValue([listing('ermou-garage', 'Γκαράζ Ερμού')]);
    await show('el');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Αγαπημένοι χώροι στάθμευσης' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Αφαίρεση από τα αγαπημένα' })).toBeInTheDocument();
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'el' }) })).toEqual({
      title: 'Αγαπημένοι χώροι στάθμευσης',
    });
  });
});
