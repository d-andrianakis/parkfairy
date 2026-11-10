import { cancelListingBooking } from '@parkfairy/api-client';
import type { OwnerListingBookings } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from '@/i18n/navigation';
import { loadOwnerBookings } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { routerMock } from '@/test/navigation-mock';
import { answer, LISTING_ID } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';
import OwnerLayout from './layout';
import OwnerBookingsPage, { generateMetadata } from './listings/[id]/bookings/page';

vi.mock('@/lib/bookings.server', () => ({ loadOwnerBookings: vi.fn() }));
vi.mock('@parkfairy/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@parkfairy/api-client')>()),
  cancelListingBooking: vi.fn(),
}));
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
  previous: null,
  next: null,
  ...overrides,
});

/** Places in the list, as the API gives them out. */
const PLACE = '4100000000000_b0b0b0b0-0000-4000-8000-000000000001';
const LATER = '4100000003600_b0b0b0b0-0000-4000-8000-000000000002';

const show = async (
  found: Awaited<ReturnType<typeof loadOwnerBookings>>,
  query: Record<string, string> = {},
  locale: 'en' | 'el' = 'en',
  cancelled?: string,
) => {
  vi.mocked(loadOwnerBookings).mockResolvedValue(found);
  return renderInOwnerArea(
    await OwnerBookingsPage({
      params: Promise.resolve({ locale, id: LISTING_ID }),
      searchParams: Promise.resolve({ ...query, ...(cancelled ? { cancelled } : {}) }),
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
    expect(loadOwnerBookings).toHaveBeenCalledWith(LISTING_ID, '', '');
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
    await show(listing(), {}, 'en', 'H3J8-W4XY');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Booking H3J8-W4XY cancelled' }),
    ).toBeVisible();
    // Only a reference reads back: anything else in the URL says nothing.
    await show(listing(), {}, 'en', '<script>');
    expect(screen.queryByText(/<script>/)).not.toBeInTheDocument();
  });

  it('says a second cancel too, though only the query changed and the page stayed', async () => {
    const page = async (cancelled: string) =>
      OwnerLayout({
        children: await OwnerBookingsPage({
          params: Promise.resolve({ locale: 'en', id: LISTING_ID }),
          searchParams: Promise.resolve({ after: PLACE, cancelled }),
        }),
      });
    vi.mocked(loadOwnerBookings).mockResolvedValue(listing());
    const { rerender } = renderWithProviders(<>{await page('H3J8-W4XY')}</>);
    // Where `RouteFocus` puts the focus after a navigation.
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    document.body.append(main);
    main.focus();
    rerender(<>{await page('K7M4-Q2ZD')}</>);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Booking K7M4-Q2ZD cancelled' }),
    ).toHaveFocus();
    main.remove();
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

  it('says when there are none, and pages through many from a place in the list', async () => {
    const none = await show(listing({ bookings: [] }));
    expect(screen.getByText('There are no bookings yet.')).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    none.unmount();

    const paged = await show(listing({ previous: PLACE, next: LATER }), { after: PLACE });
    expect(loadOwnerBookings).toHaveBeenLastCalledWith(LISTING_ID, PLACE, '');
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/bookings?before=${PLACE}`,
    );
    expect(within(pages).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/bookings?after=${LATER}`,
    );
    paged.unmount();
    await show(listing({ previous: PLACE }), { before: LATER });
    expect(loadOwnerBookings).toHaveBeenLastCalledWith(LISTING_ID, '', LATER);
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('starts from the first page for a place it never gave out, an old page number, or both ways', async () => {
    const queries: Record<string, string>[] = [
      { after: 'x' },
      { after: '999999999999999_b0b0b0b0-0000-4000-8000-000000000001' },
      { page: '3' },
      { after: PLACE, before: LATER },
    ];
    for (const query of queries) {
      await show(listing(), query);
      expect(loadOwnerBookings).toHaveBeenLastCalledWith(LISTING_ID, '', '');
    }
  });

  it('goes to the first page when nothing is left from a place, the cancel notice kept', async () => {
    await show(listing({ bookings: [] }), { after: PLACE }, 'en', 'K7M4-Q2ZD');
    expect(redirect).toHaveBeenCalledWith({
      href: {
        pathname: `/owner/listings/${LISTING_ID}/bookings`,
        query: { cancelled: 'K7M4-Q2ZD' },
      },
      locale: 'en',
    });
  });

  it('goes there from either side, in the page’s language, with nothing made up in the URL', async () => {
    const first = (query: Record<string, string>, locale: 'en' | 'el') => ({
      href: { pathname: `/owner/listings/${LISTING_ID}/bookings`, query },
      locale,
    });
    const none = await show(listing({ bookings: [] }), { before: LATER }, 'el');
    expect(redirect).toHaveBeenLastCalledWith(first({}, 'el'));
    none.unmount();
    await show(listing({ bookings: [] }), { after: PLACE }, 'en', '<script>');
    expect(redirect).toHaveBeenLastCalledWith(first({}, 'en'));
  });

  it('brings a cancel made from a place in the list back to it', async () => {
    vi.mocked(cancelListingBooking).mockResolvedValue(answer(undefined) as never);
    const { container } = await show(listing({ previous: PLACE, next: LATER }), { before: LATER });
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith({
        pathname: `/owner/listings/${LISTING_ID}/bookings`,
        query: { before: LATER, cancelled: 'K7M4-Q2ZD' },
      }),
    );
  });

  it('speaks Greek', async () => {
    await show(listing({ previous: PLACE, next: LATER }), { after: PLACE }, 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Κρατήσεις' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Ακύρωση της κράτησης K7M4-Q2ZD' }),
    ).toBeInTheDocument();
    // The locale prefix is next-intl's, which the test stand-in doesn't render.
    const pages = screen.getByRole('navigation', { name: 'Σελίδες' });
    const href = (name: string) => within(pages).getByRole('link', { name }).getAttribute('href');
    const path = `/owner/listings/${LISTING_ID}/bookings`;
    expect(href('Προηγούμενη σελίδα')?.endsWith(`${path}?before=${PLACE}`)).toBe(true);
    expect(href('Επόμενη σελίδα')?.endsWith(`${path}?after=${LATER}`)).toBe(true);
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
