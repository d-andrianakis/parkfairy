import type { OwnerCalendar, OwnerEarnings } from '@parkfairy/api-client';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOwnerCalendar, loadOwnerEarnings } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import OwnerCalendarPage, { generateMetadata as calendarMetadata } from './calendar/page';
import OwnerEarningsPage from './earnings/page';

vi.mock('@/lib/bookings.server', () => ({
  loadOwnerEarnings: vi.fn(),
  loadOwnerCalendar: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
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

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });
const earnings: OwnerEarnings = {
  sent: eur(0),
  sending: eur(0),
  coming: 0,
  held: { account: 0, dispute: 0 },
  months: [],
  listings: [],
  inProgress: [],
  lines: [],
  next: null,
};
const calendar: OwnerCalendar = {
  month: '2026-11',
  previous: '2026-10',
  next: '2026-12',
  listing: null,
  listings: [],
  days: [],
  truncated: false,
};

const params = (locale: 'en' | 'el' = 'en') => Promise.resolve({ locale });
const search = (query: Record<string, string | string[]>) => Promise.resolve(query);
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await page}</>, { locale });

beforeEach(() => {
  vi.mocked(loadOwnerEarnings).mockReset();
  vi.mocked(loadOwnerCalendar).mockReset();
  vi.mocked(requireSession).mockClear();
});

describe('the earnings page', () => {
  it('sends a stranger to sign in and back to it', async () => {
    vi.mocked(loadOwnerEarnings).mockResolvedValue(earnings);
    await show(OwnerEarningsPage({ params: params(), searchParams: search({}) }));
    expect(requireSession).toHaveBeenCalledWith('/owner/earnings');
  });

  it('says so, and shows no tables, when the API cannot answer', async () => {
    vi.mocked(loadOwnerEarnings).mockResolvedValue(null);
    await show(OwnerEarningsPage({ params: params(), searchParams: search({}) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Earnings' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your earnings can’t be shown right now');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says so in Greek too', async () => {
    vi.mocked(loadOwnerEarnings).mockResolvedValue(null);
    await show(OwnerEarningsPage({ params: params('el'), searchParams: search({}) }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Έσοδα' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Τα έσοδά σας δεν μπορούν να εμφανιστούν');
  });

  it('asks for a page only from a place a page gave out', async () => {
    vi.mocked(loadOwnerEarnings).mockResolvedValue(earnings);
    const place = `1762855200000_${ID}`;
    for (const [after, wanted] of [
      [place, place],
      ['soon', ''],
      [[place, place], ''],
      [`99999999999999999_${ID}`, ''],
    ] as const) {
      vi.mocked(loadOwnerEarnings).mockClear();
      await show(
        OwnerEarningsPage({
          params: params(),
          searchParams: search({ after: after as string | string[] }),
        }),
      );
      expect(loadOwnerEarnings).toHaveBeenCalledWith(wanted);
    }
  });
});

describe('the calendar page', () => {
  it('sends a stranger to sign in and back to it', async () => {
    vi.mocked(loadOwnerCalendar).mockResolvedValue(calendar);
    await show(OwnerCalendarPage({ params: params(), searchParams: search({}) }));
    expect(requireSession).toHaveBeenCalledWith('/owner/calendar');
  });

  it('says so, and shows no filter, when the API cannot answer', async () => {
    vi.mocked(loadOwnerCalendar).mockResolvedValue(null);
    await show(OwnerCalendarPage({ params: params(), searchParams: search({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your calendar can’t be shown right now');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('says so in Greek too', async () => {
    vi.mocked(loadOwnerCalendar).mockResolvedValue(null);
    await show(OwnerCalendarPage({ params: params('el'), searchParams: search({}) }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Ημερολόγιο' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Το ημερολόγιό σας δεν μπορεί');
  });

  it('keeps a month and a listing that are ones, and drops what is not', async () => {
    vi.mocked(loadOwnerCalendar).mockResolvedValue(calendar);
    const now = new Date();
    const thisMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Athens',
      year: 'numeric',
      month: '2-digit',
    })
      .format(now)
      .slice(0, 7);
    for (const [query, wanted] of [
      [{ month: thisMonth, listing: ID }, [thisMonth, ID]],
      [{ month: 'soon', listing: 'garage' }, ['', '']],
      [{ month: '2026-13' }, ['', '']],
      [{ month: '1999-01' }, ['', '']],
      [{ month: [thisMonth, thisMonth], listing: [ID, ID] }, ['', '']],
      // The filter's empty "all".
      [{ month: thisMonth, listing: '' }, [thisMonth, '']],
    ] as const) {
      vi.mocked(loadOwnerCalendar).mockClear();
      await show(
        OwnerCalendarPage({
          params: params(),
          searchParams: search(query as Record<string, string | string[]>),
        }),
      );
      expect(loadOwnerCalendar).toHaveBeenCalledWith(...wanted);
    }
  });

  it('names the page for the month, so moving between months is heard', async () => {
    const title = async (month: string, locale: 'en' | 'el' = 'en') =>
      (await calendarMetadata({ params: params(locale), searchParams: search({ month }) })).title;
    expect(await title('2026-11')).toBe('Calendar, November 2026');
    expect(await title('2026-11', 'el')).toBe('Ημερολόγιο, Νοέμβριος 2026');
  });
});
