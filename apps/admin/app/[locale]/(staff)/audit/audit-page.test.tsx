import type { AuditLog } from '@parkfairy/api-client';
import { adminCursor } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAudit } from '@/lib/admin.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import AuditPage from './page';

vi.mock('@/lib/admin.server', () => ({ loadAudit: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/site', () => ({
  accountPageUrl: (locale: string) => `http://site/${locale}/account`,
}));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const params = (locale: 'en' | 'el' = 'en') => Promise.resolve({ locale });
const show = async (search: Record<string, string | string[]> = {}, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(
    <>{await AuditPage({ params: params(locale), searchParams: Promise.resolve(search) })}</>,
    { locale },
  );

const entry = (over: Partial<AuditLog['entries'][number]> = {}): AuditLog['entries'][number] => ({
  id: crypto.randomUUID(),
  at: '2026-11-15T10:00:00.000Z',
  action: 'listing.changes_requested',
  actor: { id: crypto.randomUUID(), name: 'Staff Sam', email: 'sam@parkfairy.test' },
  targetType: 'listing',
  targetId: ID,
  details: { from: 'in_review', note: 'Add a photo.' },
  ...over,
});

beforeEach(() => {
  vi.mocked(loadAudit).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue({
    session: { user: {} },
    standing: 'staff',
  } as never);
});

describe('the audit log', () => {
  it('lists what was done, by whom and to what, with the details in words', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry(),
        entry({ action: 'listing.approved', details: { from: 'in_review', ownersVerified: 2 } }),
        entry({
          action: 'listing.proof_opened',
          details: { proofId: 'abc', kind: 'lease', something: 'unexpected' },
        }),
      ],
      next: null,
    });
    const { container } = await show();
    expect(requireSession).toHaveBeenCalledWith('/audit');
    const table = screen.getByRole('table', { name: 'Audit log' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Listing sent back');
    expect(rows[0]).toHaveTextContent('Staff Samsam@parkfairy.test');
    expect(rows[0]).toHaveTextContent('Was');
    expect(rows[0]).toHaveTextContent('Waiting for review');
    expect(rows[0]).toHaveTextContent('Add a photo.');
    expect(rows[1]).toHaveTextContent('Listing approved');
    expect(rows[1]).toHaveTextContent('Owners verified2');
    expect(rows[2]).toHaveTextContent('Proof document opened');
    expect(rows[2]).toHaveTextContent('Lease allowing subletting');
    // A name the screen doesn't know is shown as the log has it, not dropped.
    expect(rows[2]).toHaveTextContent('somethingunexpected');
    expect(within(rows[0]!).getByRole('link', { name: 'Open the listing' })).toHaveAttribute(
      'href',
      `/en/listings/${ID}`,
    );
    expect(within(table).getAllByRole('time')[0]).toHaveAttribute(
      'datetime',
      '2026-11-15T10:00:00.000Z',
    );
    await expectNoAxeViolations(container);
  });

  it('names the removal of a second factor and links to the account, not a listing', async () => {
    const ACCOUNT = '8a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'user.two_factor_removed',
          targetType: 'user',
          targetId: ACCOUNT,
          details: { note: 'Video call, ticket 4821', sessionsEnded: 2 },
        }),
      ],
      next: null,
    });
    const { container } = await show();
    const row = within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Two-factor authentication removed from an account');
    expect(row).toHaveTextContent('Video call, ticket 4821');
    expect(row).toHaveTextContent('Sessions ended2');
    expect(within(row).getByRole('link', { name: 'Open the account' })).toHaveAttribute(
      'href',
      `/en/users/${ACCOUNT}`,
    );
    expect(within(row).queryByRole('link', { name: 'Open the listing' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('names the removal and the opening of an account in Greek, on the 24-hour clock', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'user.two_factor_removed',
          targetType: 'user',
          at: '2026-11-15T13:05:09.000Z',
          details: { note: 'Βιντεοκλήση, αίτημα 4821', sessionsEnded: 2, passwordRevoked: true },
        }),
        entry({ action: 'user.viewed', targetType: 'user', details: {} }),
      ],
      next: null,
    });
    const { container } = await show({}, 'el');
    const rows = within(screen.getByRole('table', { name: 'Αρχείο ενεργειών' })).getAllByRole(
      'row',
    );
    expect(rows[1]).toHaveTextContent('Αφαίρεση ελέγχου ταυτότητας δύο παραγόντων από λογαριασμό');
    expect(rows[1]).toHaveTextContent('Βιντεοκλήση, αίτημα 4821');
    expect(rows[1]).toHaveTextContent('Ακυρώθηκε ο κωδικός πρόσβασηςΝαι');
    expect(rows[1]).toHaveTextContent('Συνεδρίες που έληξαν2');
    expect(within(rows[1]!).getByRole('time').textContent).toMatch(/15:05/);
    expect(rows[2]).toHaveTextContent('Άνοιγμα σελίδας λογαριασμού');
    await expectNoAxeViolations(container);
  });

  it('marks Greek in a note on an English page as Greek, and isolates the actor’s name', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          actor: { id: crypto.randomUUID(), name: 'Ελένη Παπά', email: 'e@parkfairy.test' },
          details: { note: 'Βιντεοκλήση 4821' },
        }),
      ],
      next: null,
    });
    await show();
    const row = within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row')[1]!;
    expect(row.querySelector('bdi span[lang="el"]')).toHaveTextContent('Ελένη Παπά');
    expect(row.querySelector('dd span[lang="el"]')?.textContent).toBe('Βιντεοκλήση');
    expect(row).toHaveTextContent('Βιντεοκλήση 4821');
  });

  it('puts the four moderation actions and their details in words, each linked to what it was done to', async () => {
    const ACCOUNT = '8a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'listing.suspended',
          details: {
            from: 'published',
            note: 'The deed shows another owner.',
            cancelBookings: true,
            bookingsCancelled: 3,
          },
        }),
        entry({
          action: 'listing.reinstated',
          details: { from: 'suspended', note: 'Ticket 4822.' },
        }),
        entry({
          action: 'user.suspended',
          targetType: 'user',
          targetId: ACCOUNT,
          details: { note: 'Ticket 4821.', sessionsEnded: 2 },
        }),
        entry({
          action: 'user.reinstated',
          targetType: 'user',
          targetId: ACCOUNT,
          details: { note: 'Ticket 4823.' },
        }),
      ],
      next: null,
    });
    const { container } = await show();
    const rows = within(screen.getByRole('table', { name: 'Audit log' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]).toHaveTextContent('Listing suspended');
    expect(rows[0]).toHaveTextContent('Was');
    expect(rows[0]).toHaveTextContent('Live');
    expect(rows[0]).toHaveTextContent('Bookings also cancelledYes');
    expect(rows[0]).toHaveTextContent('Bookings cancelled3');
    expect(rows[1]).toHaveTextContent('Listing reinstated');
    expect(rows[1]).toHaveTextContent('Suspended');
    expect(rows[2]).toHaveTextContent('Account suspended');
    expect(rows[2]).toHaveTextContent('Sessions ended2');
    expect(rows[3]).toHaveTextContent('Account reinstated');
    expect(within(rows[0]!).getByRole('link', { name: 'Open the listing' })).toHaveAttribute(
      'href',
      `/en/listings/${ID}`,
    );
    expect(within(rows[2]!).getByRole('link', { name: 'Open the account' })).toHaveAttribute(
      'href',
      `/en/users/${ACCOUNT}`,
    );
    // No detail the screen has no word for: each key the API writes is named.
    for (const row of rows)
      expect(row.textContent).not.toMatch(/cancelBookings|bookingsCancelled|sessionsEnded/);
    await expectNoAxeViolations(container);
  });

  it('names a booking’s lines and a dispute’s, each linked to its booking, with who bears it in words', async () => {
    const BOOKING = '3b2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'booking.viewed',
          targetType: 'booking',
          targetId: BOOKING,
          details: { reference: 'K7M4-Q2ZD' },
        }),
        entry({
          action: 'booking.cancelled',
          targetType: 'booking',
          targetId: BOOKING,
          details: { reference: 'K7M4-Q2ZD', refundMinor: 1250, note: 'Ticket 1.' },
        }),
        entry({
          action: 'booking.refund_retried',
          targetType: 'booking',
          targetId: BOOKING,
          details: { reference: 'K7M4-Q2ZD', attempt: 2, note: 'Ticket 2.' },
        }),
        entry({
          action: 'dispute.decided',
          targetType: 'dispute',
          targetId: '4c2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
          details: {
            bookingId: BOOKING,
            decision: 'owners_bear',
            amountMinor: 1250,
            note: 'Ticket 3.',
          },
        }),
      ],
      next: null,
    });
    const { container } = await show();
    const rows = within(screen.getByRole('table', { name: 'Audit log' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]).toHaveTextContent('Booking opened');
    expect(rows[1]).toHaveTextContent('Booking cancelled');
    expect(rows[1]).toHaveTextContent('Refund€12.50');
    expect(rows[2]).toHaveTextContent('Refund asked again');
    expect(rows[2]).toHaveTextContent('Attempt2');
    expect(rows[3]).toHaveTextContent('Lost dispute decided');
    expect(rows[3]).toHaveTextContent('Who bears the lossThe owners bear the loss');
    for (const row of rows.slice(0, 3)) {
      expect(within(row).getByRole('link', { name: 'Open the booking' })).toHaveAttribute(
        'href',
        `/en/bookings/${BOOKING}`,
      );
    }
    // A dispute has no page of its own: its link is its booking's, and the booking's id is no fact.
    expect(
      within(rows[3]!).getByRole('link', { name: 'Open the booking of the dispute' }),
    ).toHaveAttribute('href', `/en/bookings/${BOOKING}`);
    expect(rows[3]).not.toHaveTextContent(BOOKING);
    await expectNoAxeViolations(container);
  });

  it('names the same four in Greek', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'listing.suspended',
          details: { from: 'published', cancelBookings: false, bookingsCancelled: 0 },
        }),
        entry({ action: 'listing.reinstated', details: { from: 'suspended' } }),
        entry({ action: 'user.suspended', targetType: 'user', details: { sessionsEnded: 1 } }),
        entry({ action: 'user.reinstated', targetType: 'user', details: {} }),
      ],
      next: null,
    });
    const { container } = await show({}, 'el');
    const rows = within(screen.getByRole('table', { name: 'Αρχείο ενεργειών' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]).toHaveTextContent('Αναστολή χώρου');
    expect(rows[0]).toHaveTextContent('Ακυρώθηκαν και οι κρατήσειςΌχι');
    expect(rows[1]).toHaveTextContent('Άρση αναστολής χώρου');
    expect(rows[2]).toHaveTextContent('Αναστολή λογαριασμού');
    expect(rows[3]).toHaveTextContent('Άρση αναστολής λογαριασμού');
    await expectNoAxeViolations(container);
  });

  it('says what it can of an action it does not know yet, and shows each kind of value in words', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'listing.vanished' as never,
          details: { flag: true, other: false, count: 12345, missing: null },
        }),
      ],
      next: null,
    });
    await show();
    const row = within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Other action');
    expect(row).not.toHaveTextContent('listing.vanished');
    expect(row).toHaveTextContent('flagYes');
    expect(row).toHaveTextContent('otherNo');
    expect(row).toHaveTextContent('count12,345');
    expect(row).toHaveTextContent('missingNot given');
  });

  it('puts the time first in each row, as the row’s header', async () => {
    vi.mocked(loadAudit).mockResolvedValue({ entries: [entry()], next: null });
    await show();
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent(/Nov 15, 2026/);
  });

  it('shows no details for an entry without any', async () => {
    vi.mocked(loadAudit).mockResolvedValue({ entries: [entry({ details: {} })], next: null });
    await show();
    expect(screen.queryByRole('term')).toBeNull();
  });

  it('filters by the kind of action, and marks the one shown', async () => {
    vi.mocked(loadAudit).mockResolvedValue({ entries: [], next: null });
    await show({ action: 'listing.approved' });
    expect(loadAudit).toHaveBeenCalledWith('listing.approved', undefined);
    const filter = screen.getByRole('navigation', { name: 'Kind of action' });
    expect(within(filter).getByRole('link', { name: 'Listing approved' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(filter).getByRole('link', { name: 'Everything' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(filter).getByRole('link', { name: 'Everything' })).toHaveAttribute(
      'href',
      '/en/audit',
    );
    expect(screen.getByText('Nothing has been recorded yet.')).toBeInTheDocument();
  });

  it('pages on, and back to the newest, keeping the filter', async () => {
    vi.mocked(loadAudit).mockResolvedValue({ entries: [entry()], next: 'NEXT-PLACE' });
    const place = adminCursor(new Date('2026-11-15T10:00:00.000Z'), ID);
    await show({ action: 'listing.approved', after: place });
    expect(loadAudit).toHaveBeenCalledWith('listing.approved', place);
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      '/en/audit?action=listing.approved&after=NEXT-PLACE',
    );
  });

  it('reads a mangled filter or place as the whole log, each on its own', async () => {
    vi.mocked(loadAudit).mockResolvedValue({ entries: [], next: null });
    await show({ action: 'nonsense', after: 'garbage' });
    expect(loadAudit).toHaveBeenLastCalledWith(undefined, undefined);
    await show({ action: 'listing.approved', after: 'garbage' });
    expect(loadAudit).toHaveBeenLastCalledWith('listing.approved', undefined);
    await show({ action: ['listing.approved', 'x'] });
    expect(loadAudit).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it('says the account is not staff, and asks for no log', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show();
    expect(
      screen.getByRole('heading', { level: 1, name: 'This account is not staff' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /account page on the public site/ })).toBeNull();
    expect(loadAudit).not.toHaveBeenCalled();
  });

  it('shows no log to staff without a second factor, and asks for none', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'no-second-factor',
    } as never);
    await show();
    expect(screen.getByRole('link', { name: /account page on the public site/ })).toHaveAttribute(
      'href',
      'http://site/en/account',
    );
    expect(loadAudit).not.toHaveBeenCalled();
  });

  it('says so when the log cannot be read', async () => {
    vi.mocked(loadAudit).mockResolvedValue('unavailable');
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent('This could not be loaded');
  });

  it('reads in Greek', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [entry({ action: 'listing.approved' })],
      next: null,
    });
    await show({}, 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Αρχείο ενεργειών' })).toBeInTheDocument();
    expect(screen.getByText('Έγκριση χώρου', { selector: 'td' })).toBeInTheDocument();
  });
});
