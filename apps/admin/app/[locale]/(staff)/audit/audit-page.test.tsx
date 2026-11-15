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

  it('says what it can of an action it does not know yet, and shows each kind of value in words', async () => {
    vi.mocked(loadAudit).mockResolvedValue({
      entries: [
        entry({
          action: 'listing.suspended' as never,
          details: { flag: true, other: false, count: 12345, missing: null },
        }),
      ],
      next: null,
    });
    await show();
    const row = within(screen.getByRole('table', { name: 'Audit log' })).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Other action');
    expect(row).not.toHaveTextContent('listing.suspended');
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
