import type { OwnerListingBookings } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnerBookings } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { LISTING_ID } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';
import OwnerLayout from './layout';
import OwnerBookingsPage, { generateMetadata } from './listings/[id]/bookings/page';

vi.mock('@/lib/bookings.server', () => ({ loadOwnerBookings: vi.fn() }));
vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve()),
  getLayoutSession: vi.fn(() => Promise.resolve({ user: { id: 'u' } })),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));
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

const renderInOwnerArea = async (page: ReactElement, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await OwnerLayout({ children: page })}</>, { locale });

const booking = (id: string, reference: string, cancellable = true) => ({
  id,
  reference,
  spaceLabel: 'Α1',
  start: '2099-12-10T08:00:00.000Z',
  end: '2099-12-10T10:00:00.000Z',
  driverName: 'Νίκος Οδηγός',
  vehiclePlate: 'IKB1234',
  total: { amountMinor: 400, currency: 'EUR' as const },
  cancellable,
});
const listing = (overrides: Partial<OwnerListingBookings> = {}): OwnerListingBookings => ({
  id: LISTING_ID,
  name: 'Γκαράζ Ερμού',
  contentLocale: 'el',
  bookings: [
    booking('b0b0b0b0-0000-4000-8000-000000000001', 'K7M4-Q2ZD'),
    booking('b0b0b0b0-0000-4000-8000-000000000002', 'H3J8-W4XY', false),
  ],
  page: 1,
  hasMore: false,
  ...overrides,
});

const show = async (
  found: Awaited<ReturnType<typeof loadOwnerBookings>>,
  page?: string,
  locale: 'en' | 'el' = 'en',
  cancelled?: string,
) => {
  vi.mocked(loadOwnerBookings).mockResolvedValue(found);
  return renderInOwnerArea(
    await OwnerBookingsPage({
      params: Promise.resolve({ locale, id: LISTING_ID }),
      searchParams: Promise.resolve({
        ...(page ? { page } : {}),
        ...(cancelled ? { cancelled } : {}),
      }),
    }),
    locale,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a listing’s bookings page', () => {
  it('shows who is coming in which car, and lets the owner call off what hasn’t begun', async () => {
    const { container } = await show(listing());
    expect(requireSession).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/bookings`);
    expect(loadOwnerBookings).toHaveBeenCalledWith(LISTING_ID, 1);
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();
    expect(screen.getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    const [first, second] = screen.getAllByRole('listitem');
    expect(
      within(first as HTMLElement).getByRole('heading', { name: 'Booking K7M4-Q2ZD' }),
    ).toBeVisible();
    expect(within(first as HTMLElement).getByText('Νίκος Οδηγός')).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('IKB1234')).toBeInTheDocument();
    expect(
      within(first as HTMLElement).getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' }),
    ).toBeInTheDocument();
    expect(within(second as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(within(second as HTMLElement).getByText(/Under way/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('names the booking just called off, in a notice that takes the focus', async () => {
    await show(listing(), undefined, 'en', 'H3J8-W4XY');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Booking H3J8-W4XY cancelled' }),
    ).toBeVisible();
    // Only a reference reads back: anything else in the URL says nothing.
    await show(listing(), undefined, 'en', '<script>');
    expect(screen.queryByText(/<script>/)).not.toBeInTheDocument();
  });

  it('isolates the driver’s name, and leads back to closures', async () => {
    await show(listing());
    expect(screen.getAllByText('Νίκος Οδηγός')[0]?.tagName).toBe('BDI');
    expect(screen.getByRole('link', { name: 'Closures and special hours' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/closures`,
    );
  });

  it('treats another owner’s listing as none at all, and an outage as an outage', async () => {
    await expect(show('not-found')).rejects.toThrow('not found');
    await show('unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });

  it('says when there are none, and pages through many', async () => {
    await show(listing({ bookings: [] }));
    expect(screen.getByText('There are no bookings yet.')).toBeInTheDocument();
    await show(listing({ page: 2, hasMore: true }), '2');
    expect(loadOwnerBookings).toHaveBeenLastCalledWith(LISTING_ID, 2);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/bookings?page=3`,
    );
  });

  it('speaks Greek', async () => {
    await show(listing(), undefined, 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Κρατήσεις' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Ακύρωση της κράτησης K7M4-Q2ZD' }),
    ).toBeInTheDocument();
  });

  it('names the tab for the listing', async () => {
    vi.mocked(loadOwnerBookings).mockResolvedValue(listing());
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', id: LISTING_ID }),
      searchParams: Promise.resolve({}),
    });
    expect(metadata.title).toBe('Bookings for “Γκαράζ Ερμού”');
  });
});
