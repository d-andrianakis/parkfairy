import type { OwnerBookingList } from '@parkfairy/api-client';
import { ownerBookingsReach } from '@parkfairy/contracts';
import { cleanup, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOwnerBookingList } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import OwnerBookingListPage, { generateMetadata } from './page';

vi.mock('@/lib/bookings.server', () => ({ loadOwnerBookingList: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
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

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const PLACE = '1700000000000_5b1d3a52-3f0e-4a77-9a5b-9d4d2c4f6a10';
const empty: OwnerBookingList = {
  status: 'upcoming',
  listing: null,
  from: null,
  to: null,
  listings: [],
  bookings: [],
  previous: null,
  next: null,
};

const params = (locale: 'en' | 'el' = 'en') => Promise.resolve({ locale });
const search = (query: Record<string, string | string[]>) => Promise.resolve(query);
const show = async (query: Record<string, string | string[]> = {}, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(
    <>{await OwnerBookingListPage({ params: params(locale), searchParams: search(query) })}</>,
    { locale },
  );

beforeEach(() => {
  vi.mocked(loadOwnerBookingList).mockReset();
  vi.mocked(loadOwnerBookingList).mockResolvedValue(empty);
  vi.mocked(requireSession).mockClear();
});

describe('the bookings list page', () => {
  it('sends a stranger to sign in and back to it', async () => {
    await show();
    expect(requireSession).toHaveBeenCalledWith('/owner/bookings');
  });

  it('has one h1, a way back, and the list', async () => {
    await show();
    expect(screen.getByRole('heading', { level: 1, name: 'All bookings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/en/owner');
    expect(screen.getByText('No upcoming bookings.')).toBeInTheDocument();
  });

  it('says so, and shows no filters, when the API cannot answer', async () => {
    vi.mocked(loadOwnerBookingList).mockResolvedValue(null);
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent('Your bookings can’t be shown right now');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('says so in Greek too', async () => {
    vi.mocked(loadOwnerBookingList).mockResolvedValue(null);
    await show({}, 'el');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Όλες οι κρατήσεις' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Οι κρατήσεις δεν μπορούν να εμφανιστούν');
  });

  it('keeps what the address asks for that is a status, listing, days and a place', async () => {
    await show({ status: 'past', listing: ID, from: '2026-10-01', to: '2026-10-31', after: PLACE });
    expect(loadOwnerBookingList).toHaveBeenCalledWith(
      'past',
      ID,
      '2026-10-01',
      '2026-10-31',
      PLACE,
      '',
    );
    vi.mocked(loadOwnerBookingList).mockClear();
    await show({ before: PLACE });
    expect(loadOwnerBookingList).toHaveBeenCalledWith('upcoming', '', '', '', '', PLACE);
  });

  it('drops what is not one: the first page of what is coming', async () => {
    const queries: Record<string, string | string[]>[] = [
      { status: 'all', listing: 'garage', from: 'yesterday', to: '2026-02-30', after: 'next' },
      { status: ['past', 'cancelled'], listing: [ID, ID], from: ['2026-10-01'], after: [PLACE] },
      // The form's empty fields, and years the API doesn't take.
      { status: 'past', listing: '', from: '', to: '' },
      { from: '1999-12-31', to: '9999-12-31' },
      // A mangled link with both places.
      { after: PLACE, before: PLACE },
    ];
    for (const query of queries) {
      vi.mocked(loadOwnerBookingList).mockClear();
      await show(query);
      const [status, listing, from, to, after, before] =
        vi.mocked(loadOwnerBookingList).mock.calls[0] ?? [];
      expect([listing, from, to, after, before], JSON.stringify(query)).toEqual([
        '',
        '',
        '',
        '',
        '',
      ]);
      expect(['upcoming', 'past']).toContain(status);
    }
  });

  it('tells of days the API would refuse, and reads no days at all', async () => {
    await show({ status: 'past', from: '2026-11-02', to: '2026-11-01', after: PLACE });
    expect(loadOwnerBookingList).toHaveBeenCalledWith('past', '', '', '', '', '');
    expect(screen.getByRole('alert')).toHaveTextContent('The last day is before the first day');
    // The fields keep what was typed, to be corrected.
    expect(screen.getByLabelText('First day')).toHaveValue('2026-11-02');
    expect(screen.getByLabelText('Last day')).toHaveValue('2026-11-01');

    vi.mocked(loadOwnerBookingList).mockClear();
    await show({ from: '2025-01-01', to: '2026-01-02' });
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(loadOwnerBookingList).toHaveBeenCalledWith('upcoming', '', '', '', '', '');
  });

  it('accepts a window of exactly a year', async () => {
    await show({ status: 'past', from: '2025-11-17', to: '2026-11-16' });
    expect(loadOwnerBookingList).toHaveBeenCalledWith(
      'past',
      '',
      '2025-11-17',
      '2026-11-16',
      '',
      '',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is titled for the group, so moving between them is heard, in both languages', async () => {
    const title = async (query: Record<string, string>, locale: 'en' | 'el' = 'en') =>
      (await generateMetadata({ params: params(locale), searchParams: search(query) })).title;
    expect(await title({})).toBe('Upcoming bookings');
    expect(await title({ status: 'past' })).toBe('Past bookings');
    expect(await title({ status: 'cancelled' })).toBe('Cancelled bookings');
    expect(await title({ status: 'cancelled' }, 'el')).toBe('Ακυρωμένες κρατήσεις');
    expect(await title({ status: 'past', from: 'soon' }, 'el')).toBe('Παλαιότερες κρατήσεις');
  });

  it('says in the title, which is what is announced after the form is sent, that days were refused', async () => {
    const title = async (query: Record<string, string>, locale: 'en' | 'el' = 'en') =>
      (await generateMetadata({ params: params(locale), searchParams: search(query) })).title;
    const { min } = ownerBookingsReach();
    expect(await title({ from: '2026-11-02', to: '2026-11-01' })).toBe('Error: Upcoming bookings');
    expect(await title({ status: 'past', from: min, to: '2026-11-01' }, 'el')).toBe(
      'Σφάλμα: Παλαιότερες κρατήσεις',
    );
  });

  it('tells which rule was broken: the order of the days, or more than a year between them', async () => {
    const { min } = ownerBookingsReach();
    await show({ from: '2026-11-02', to: '2026-11-01' });
    expect(screen.getByRole('alert')).toHaveTextContent('The last day is before the first day');
    cleanup();
    await show({ from: min, to: '2026-11-01' });
    expect(screen.getByRole('alert')).toHaveTextContent('more than a year apart');
  });

  it('keeps a day that is one when the other is not', async () => {
    await show({ from: '2026-10-01', to: 'tomorrow' });
    expect(loadOwnerBookingList).toHaveBeenCalledWith('upcoming', '', '2026-10-01', '', '', '');
  });

  it('keeps no listing that is not an id, as the API would refuse it', async () => {
    await show({ listing: 'not-an-id' });
    expect(loadOwnerBookingList).toHaveBeenCalledWith('upcoming', '', '', '', '', '');
  });
});
