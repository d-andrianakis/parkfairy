import type { AdminListingReview, AdminQueue } from '@parkfairy/api-client';
import { adminCursor } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { cleanup, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadQueue, loadReview } from '@/lib/admin.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { notFoundMock } from '@/test/server-mocks';

import ReviewPage from './[id]/page';
import QueuePage from './page';

vi.mock('@/lib/admin.server', () => ({ loadQueue: vi.fn(), loadReview: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/server-env', () => ({
  parseServerEnv: () => ({ BETTER_AUTH_URL: 'http://localhost:3000' }),
}));
vi.mock('@/lib/admin-client', () => ({
  approve: vi.fn(),
  requestChanges: vi.fn(),
  suspendListing: vi.fn(),
  reinstateListing: vi.fn(),
  useAdminError: () => () => 'error',
}));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());
vi.mock('next/navigation', async () => ({
  notFound: (await import('@/test/server-mocks')).notFoundMock,
}));

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const staff = { session: { user: { name: 'Staff Sam' } }, standing: 'staff' as const };
const params = (locale: 'en' | 'el' = 'en') => Promise.resolve({ locale });
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await page}</>, { locale });

const item = (over: Partial<AdminQueue['listings'][number]> = {}) => ({
  id: ID,
  status: 'in_review' as const,
  name: 'Γκαράζ Ερμού',
  address: 'Ερμού 1, Αθήνα',
  contentLocale: 'el' as const,
  owner: 'Maria Owner',
  submittedAt: '2026-11-10T09:30:00.000Z',
  ...over,
});

const review = (over: Partial<AdminListingReview> = {}): AdminListingReview => ({
  id: ID,
  status: 'in_review',
  name: 'Γκαράζ Ερμού',
  description: 'Κλειστό γκαράζ.\nΜε κάμερες.',
  address: 'Ερμού 1, Αθήνα',
  areaId: 'syntagma',
  contentLocale: 'el',
  landRegistrationNumber: '123456789012',
  hourlyRate: { amountMinor: 250, currency: 'EUR' },
  spaces: ['Α1', 'Α2'],
  photos: 3,
  submittedAt: '2026-11-10T09:30:00.000Z',
  reviewNote: null,
  owners: [
    {
      role: 'primary',
      accountName: 'Maria Owner',
      kind: 'individual',
      firstName: 'Μαρία',
      lastName: 'Παπά',
      legalName: null,
      country: 'GR',
      taxCountry: 'GR',
      taxIdEnding: '216',
      vatIdEnding: null,
      registrationEnding: null,
      verification: 'pending',
      sharePercent: 100,
      detailsComplete: true,
    },
  ],
  proofs: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'lease',
      fileName: 'lease.pdf',
      contentType: 'application/pdf',
      sizeBytes: 20480,
      createdAt: '2026-11-10T09:00:00.000Z',
    },
  ],
  canDecide: true,
  canSuspend: false,
  canReinstate: false,
  upcomingBookings: 0,
  own: false,
  ...over,
});

beforeEach(() => {
  vi.mocked(loadQueue).mockReset();
  vi.mocked(loadReview).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(staff as never);
  notFoundMock.mockClear();
});

describe('the queue', () => {
  it('asks for sign-in with its own address, and shows staff the table', async () => {
    vi.mocked(loadQueue).mockResolvedValue({ listings: [item()], next: null });
    const { container } = await show(
      QueuePage({ params: params(), searchParams: Promise.resolve({}) }),
    );
    expect(requireSession).toHaveBeenCalledWith('/listings');
    expect(screen.getByRole('heading', { level: 1, name: 'Listings' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Listings, status: Waiting for review' });
    const link = within(table).getByRole('link', { name: 'Γκαράζ Ερμού' });
    expect(link).toHaveAttribute('href', `/en/listings/${ID}`);
    expect(link).toHaveAttribute('lang', 'el');
    expect(within(table).getByText('Ερμού 1, Αθήνα')).toHaveAttribute('lang', 'el');
    expect(within(table).getByText('Maria Owner')).toBeInTheDocument();
    expect(within(table).getByText(/Nov 10, 2026/)).toHaveAttribute(
      'datetime',
      '2026-11-10T09:30:00.000Z',
    );
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('marks the status it shows, in words as well as colour', async () => {
    vi.mocked(loadQueue).mockResolvedValue({ listings: [], next: null });
    await show(
      QueuePage({ params: params(), searchParams: Promise.resolve({ status: 'published' }) }),
    );
    expect(loadQueue).toHaveBeenCalledWith('published', undefined);
    const filter = screen.getByRole('navigation', { name: 'Listing status' });
    expect(within(filter).getByRole('link', { name: 'Live' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(filter).getByRole('link', { name: 'Sent back' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('pages by the place the API gave, and offers the way back to the first page', async () => {
    vi.mocked(loadQueue).mockResolvedValue({ listings: [item()], next: 'NEXT-PLACE' });
    const place = adminCursor(new Date('2026-11-10T09:30:00.000Z'), ID);
    await show(
      QueuePage({
        params: params(),
        searchParams: Promise.resolve({ status: 'in_review', after: place }),
      }),
    );
    expect(loadQueue).toHaveBeenCalledWith('in_review', place);
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/en/listings?status=in_review&after=NEXT-PLACE',
    );
  });

  it('reads a mangled address as the default, not an error', async () => {
    vi.mocked(loadQueue).mockResolvedValue({ listings: [], next: null });
    await show(
      QueuePage({
        params: params(),
        searchParams: Promise.resolve({ status: 'nonsense', after: ['a', 'b'] }),
      }),
    );
    expect(loadQueue).toHaveBeenCalledWith('in_review', undefined);
    await show(
      QueuePage({
        params: params(),
        searchParams: Promise.resolve({ status: 'published', after: 'garbage' }),
      }),
    );
    expect(loadQueue).toHaveBeenLastCalledWith('published', undefined);
  });

  it('shows an account that is not staff its standing, and asks the API for nothing', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(QueuePage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'This account is not staff' }),
    ).toBeInTheDocument();
    expect(loadQueue).not.toHaveBeenCalled();
  });

  it('sends staff without a second factor to the public account page', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'no-second-factor',
    } as never);
    await show(QueuePage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: /account page on the public site/ })).toHaveAttribute(
      'href',
      'http://localhost:3000/en/account',
    );
    expect(loadQueue).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'You can’t see this'],
    ['unavailable', 'This could not be loaded'],
  ] as const)('says so in an alert when the API answers %s', async (reason, title) => {
    vi.mocked(loadQueue).mockResolvedValue(reason);
    await show(QueuePage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent(title);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reads in Greek', async () => {
    vi.mocked(loadQueue).mockResolvedValue({ listings: [item()], next: null });
    await show(QueuePage({ params: params('el'), searchParams: Promise.resolve({}) }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Χώροι' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Αναμένει έλεγχο' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('every staff screen, for an account that is not ready to use it', () => {
  const titles = {
    'not-staff': 'This account is not staff',
    'no-second-factor': 'Turn on two-factor first',
  } as const;

  it.each(['not-staff', 'no-second-factor'] as const)(
    'shows the queue and a review nothing but the standing (%s), and asks the API for nothing',
    async (standing) => {
      vi.mocked(requireSession).mockResolvedValue({ session: { user: {} }, standing } as never);
      await show(QueuePage({ params: params(), searchParams: Promise.resolve({}) }));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(titles[standing]);
      cleanup();
      await show(ReviewPage({ params: Promise.resolve({ locale: 'en', id: ID }) }));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(titles[standing]);
      expect(loadQueue).not.toHaveBeenCalled();
      expect(loadReview).not.toHaveBeenCalled();
    },
  );
});

describe('a listing’s review', () => {
  const page = (id = ID, locale: 'en' | 'el' = 'en') =>
    ReviewPage({ params: Promise.resolve({ locale, id }) });

  it('shows what was sent in, the owners by the end of their tax numbers, and the documents', async () => {
    vi.mocked(loadReview).mockResolvedValue(review());
    const { container } = await show(page());
    expect(requireSession).toHaveBeenCalledWith(`/listings/${ID}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Γκαράζ Ερμού' })).toHaveAttribute(
      'lang',
      'el',
    );
    expect(screen.getByText('€2.50 an hour')).toBeInTheDocument();
    expect(screen.getByText('Syntagma')).toBeInTheDocument();
    expect(screen.getByText('Α1 and Α2')).toHaveAttribute('lang', 'el');
    expect(screen.getByText(/2 spaces:/)).toBeInTheDocument();
    expect(screen.getByText('123456789012')).toBeInTheDocument();

    const owners = screen.getByRole('list', { name: 'The listing’s owners and their details' });
    expect(within(owners).getByRole('heading', { level: 3 })).toHaveTextContent('Maria Owner');
    expect(owners).toHaveTextContent('Primary owner');
    expect(owners).toHaveTextContent('Tax number: ending in 216');
    expect(owners).toHaveTextContent('Waiting for this review');
    expect(owners).toHaveTextContent('100%');

    const proof = screen.getByRole('link', { name: /Lease allowing subletting: lease\.pdf/ });
    expect(proof).toHaveAttribute(
      'href',
      `/api/v1/admin/listings/${ID}/proofs/11111111-1111-4111-8111-111111111111`,
    );
    expect(proof).toHaveAttribute('download');
    expect(screen.getByText(/Opening a document is recorded/)).toBeInTheDocument();
    // The decision is there, for someone else's listing waiting for one.
    expect(screen.getByRole('button', { name: 'Approve this listing' })).toBeInTheDocument();
    expect(screen.getByLabelText('What should the owner change?')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows the last note to the owner, and no decision for a listing nobody is waiting on', async () => {
    vi.mocked(loadReview).mockResolvedValue(
      review({
        status: 'changes_requested',
        canDecide: false,
        reviewNote: 'Add a photo.\nThanks.',
      }),
    );
    await show(page());
    expect(screen.getByText(/Add a photo\./)).toBeInTheDocument();
    expect(screen.getByText('What was last asked of the owner')).toBeInTheDocument();
    expect(
      screen.getByText(/not waiting for a decision. Its status is: Sent back/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this listing' })).toBeNull();
  });

  it('offers a live listing’s suspension, with the bookings it could cancel, and no decision', async () => {
    vi.mocked(loadReview).mockResolvedValue(
      review({ status: 'published', canDecide: false, canSuspend: true, upcomingBookings: 2 }),
    );
    const { container } = await show(page());
    expect(
      screen.getByRole('heading', { level: 2, name: 'Take it down or bring it back' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend this listing…' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Also cancel its 2 upcoming bookings' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this listing' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('offers a suspended listing’s reinstatement, and shows the owners’ note on it', async () => {
    vi.mocked(loadReview).mockResolvedValue(
      review({
        status: 'suspended',
        canDecide: false,
        canReinstate: true,
        reviewNote: 'The deed shows another owner.',
      }),
    );
    await show(page());
    expect(screen.getByRole('button', { name: 'Reinstate this listing…' })).toBeInTheDocument();
    expect(screen.getByText('The deed shows another owner.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows no moderation for a listing still being reviewed, nor a draft’s way in', async () => {
    vi.mocked(loadReview).mockResolvedValue(review({ status: 'in_review' }));
    await show(page());
    expect(screen.queryByRole('heading', { name: 'Take it down or bring it back' })).toBeNull();
  });

  it('keeps people from deciding their own listing', async () => {
    vi.mocked(loadReview).mockResolvedValue(review({ own: true }));
    await show(page());
    expect(screen.getByText(/someone else on the staff has to decide/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this listing' })).toBeNull();
  });

  it('shows what is missing in a listing not yet complete, and no documents', async () => {
    vi.mocked(loadReview).mockResolvedValue(
      review({
        name: null,
        address: null,
        areaId: null,
        hourlyRate: null,
        spaces: [],
        proofs: [],
        landRegistrationNumber: null,
        submittedAt: null,
        description: null,
        owners: [
          {
            ...review().owners[0]!,
            taxIdEnding: null,
            kind: null,
            country: null,
            detailsComplete: false,
            verification: 'unverified',
          },
        ],
      }),
    );
    await show(page());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Unnamed listing');
    expect(screen.getByText('No document was sent in.')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
  });

  it('is not found for what is no listing’s address, without asking the API', async () => {
    await expect(page('not-an-id')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadReview).not.toHaveBeenCalled();
  });

  it('is not found when the API says so', async () => {
    vi.mocked(loadReview).mockResolvedValue('not-found');
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('says so when it cannot be loaded, with the way back', async () => {
    vi.mocked(loadReview).mockResolvedValue('unavailable');
    await show(page());
    expect(screen.getByRole('alert')).toHaveTextContent('This could not be loaded');
    expect(screen.getByRole('link', { name: 'Back to the listings' })).toHaveAttribute(
      'href',
      '/en/listings',
    );
  });

  it('shows nothing of a listing to an account that is not staff', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(page());
    expect(
      screen.getByRole('heading', { level: 1, name: 'This account is not staff' }),
    ).toBeInTheDocument();
    expect(loadReview).not.toHaveBeenCalled();
  });

  it('reads in Greek, money and dates included', async () => {
    vi.mocked(loadReview).mockResolvedValue(review());
    await show(page(ID, 'el'), 'el');
    expect(screen.getByText(/2,50\s€ την ώρα/)).toBeInTheDocument();
    expect(screen.getByText('Σύνταγμα')).toBeInTheDocument();
    expect(screen.getByText('Α1 και Α2')).toHaveAttribute('lang', 'el');
    expect(screen.getByText(/2 χώροι:/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Μισθωτήριο με υπεκμίσθωση: lease.pdf/ }),
    ).toBeInTheDocument();
  });
});
