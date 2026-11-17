import type { EarningLine, OwnerEarnings } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { EarningsView } from './earnings-view';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });
const listing = { id: ID, name: 'Γκαράζ Κολωνακίου', contentLocale: 'el' as const };
const line = (patch: Partial<EarningLine> = {}): EarningLine => ({
  id: ID,
  reference: 'K7M4-Q2ZD',
  listing,
  end: '2026-11-10T09:00:00.000Z',
  state: 'sent',
  amount: eur(25_200),
  sentAt: '2026-11-11T10:00:00.000Z',
  hold: null,
  ...patch,
});
const earnings = (patch: Partial<OwnerEarnings> = {}): OwnerEarnings => ({
  sent: eur(25_200),
  sending: eur(0),
  coming: 3,
  held: { account: 0, dispute: 0 },
  months: [{ month: '2026-11', amount: eur(25_200) }],
  listings: [{ listing, amount: eur(25_200) }],
  inProgress: [],
  lines: [line()],
  next: null,
  ...patch,
});
const first = { after: '' };

describe('EarningsView', () => {
  it('sums up what was sent, what is on its way and what is still to come', () => {
    renderWithProviders(
      <EarningsView earnings={earnings({ sending: eur(10_800) })} place={first} />,
    );
    const summary = within(screen.getByLabelText('Summary'));
    expect(summary.getByText('Sent to you').nextElementSibling).toHaveTextContent('€252.00');
    expect(summary.getByText('Worked out, not sent yet').nextElementSibling).toHaveTextContent(
      '€108.00',
    );
    expect(
      summary.getByText('Paid bookings not worked out yet').nextElementSibling,
    ).toHaveTextContent('3');
  });

  it('lists the parts sent in a table a screen reader can walk, the listing’s name in its language', async () => {
    const { container } = renderWithProviders(<EarningsView earnings={earnings()} place={first} />);
    const table = screen.getByRole('table', { name: 'Shares sent to you, newest first' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Booking', 'Sent on', 'Your share']);
    const row = within(table).getByRole('rowheader', { name: /K7M4-Q2ZD/ });
    expect(row).toHaveTextContent('Γκαράζ Κολωνακίου');
    expect(within(row).getByText('Γκαράζ Κολωνακίου').closest('[lang]')).toHaveAttribute(
      'lang',
      'el',
    );
    expect(within(table).getByText('€252.00')).toBeInTheDocument();
    expect(within(table).getByText('Nov 11, 2026')).toHaveAttribute(
      'datetime',
      '2026-11-11T10:00:00.000Z',
    );
    await expectNoAxeViolations(container);
  });

  it('names the months in the reader’s language, with a caption per table', () => {
    renderWithProviders(<EarningsView earnings={earnings()} place={first} />, { locale: 'el' });
    const months = screen.getByRole('table', {
      name: 'Ποσό που σας εστάλη σε καθέναν από τους τελευταίους 12 μήνες',
    });
    expect(within(months).getByRole('rowheader')).toHaveTextContent('Νοέμβριος 2026');
    expect(within(months).getByText(/252,00/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ανά χώρο' })).toBeInTheDocument();
  });

  it('says why a part has not gone, in words and not colour alone', async () => {
    const { container } = renderWithProviders(
      <EarningsView
        earnings={earnings({
          sending: eur(31_600),
          held: { account: 1, dispute: 2 },
          inProgress: [
            line({ id: '1'.repeat(8) + ID.slice(8), state: 'sending', sentAt: null, hold: null }),
            line({
              id: '2'.repeat(8) + ID.slice(8),
              reference: 'A6GT-K7C0',
              state: 'sending',
              sentAt: null,
              hold: 'account',
            }),
            line({
              id: '3'.repeat(8) + ID.slice(8),
              reference: 'B7GT-K7C0',
              state: 'sending',
              sentAt: null,
              hold: 'dispute',
            }),
          ],
        })}
        place={first}
      />,
    );
    expect(screen.getByText('Being sent')).toBeInTheDocument();
    expect(screen.getByText('Waiting: Stripe can’t pay you yet')).toBeInTheDocument();
    expect(screen.getByText('On hold: disputed payment')).toBeInTheDocument();
    // Counted by a plural: one booking is, two bookings are.
    expect(screen.getByText(/1 booking is waiting because Stripe can’t pay you yet/)).toBeVisible();
    expect(
      screen.getByText(/2 bookings are on hold while drivers’ banks dispute the payments/),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to payouts' })).toHaveAttribute(
      'href',
      '/en/owner/payouts',
    );
    await expectNoAxeViolations(container);
  });

  it('says a part will not be paid when staff decided the owners bear a lost dispute, in both languages', async () => {
    const lost = earnings({
      sending: eur(31_600),
      held: { account: 0, dispute: 0 },
      inProgress: [
        line({
          id: '4'.repeat(8) + ID.slice(8),
          reference: 'C8GT-K7C0',
          state: 'sending',
          sentAt: null,
          hold: 'lost',
        }),
      ],
    });
    const { container, unmount } = renderWithProviders(
      <EarningsView earnings={lost} place={first} />,
    );
    expect(screen.getByText('Not paid: the bank decided for the driver')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    unmount();
    renderWithProviders(<EarningsView earnings={lost} place={first} />, { locale: 'el' });
    expect(
      screen.getByText('Δεν καταβάλλεται: η τράπεζα έκρινε υπέρ του οδηγού'),
    ).toBeInTheDocument();
  });

  it('says so, without an empty table, when nothing has been sent', () => {
    renderWithProviders(
      <EarningsView
        earnings={earnings({ sent: eur(0), months: [], listings: [], lines: [], coming: 0 })}
        place={first}
      />,
    );
    expect(screen.getByText(/Nothing has been sent to you yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('pages: older from a place, and back to the newest, the totals only on the first', () => {
    const next = '1762855200000_7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
    const { rerender } = renderWithProviders(
      <EarningsView earnings={earnings({ next })} place={first} />,
    );
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      `/en/owner/earnings?after=${next}`,
    );
    expect(within(pages).queryByRole('link', { name: 'Back to the newest' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Sent by month' })).toBeInTheDocument();

    rerender(<EarningsView earnings={earnings()} place={{ after: next }} />);
    expect(screen.getByRole('link', { name: 'Back to the newest' })).toHaveAttribute(
      'href',
      '/en/owner/earnings',
    );
    expect(screen.queryByRole('heading', { name: 'Sent by month' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'By listing' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Older' })).toBeNull();
  });

  it('calls a listing the owner emptied by the dashboard’s name for it', () => {
    renderWithProviders(
      <EarningsView
        earnings={earnings({ lines: [line({ listing: { ...listing, name: null } })] })}
        place={first}
      />,
    );
    expect(screen.getAllByText('Unnamed listing').length).toBeGreaterThan(0);
  });
});
