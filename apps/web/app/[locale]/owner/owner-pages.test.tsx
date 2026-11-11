import { LISTING_STEPS, type OwnerOtherListings } from '@parkfairy/contracts';
import { screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadOtherListings,
  loadOwnerClosures,
  loadOwnerListing,
  loadOwnerProfile,
} from '@/lib/owner.server';
import { requireSession } from '@/lib/session';
import { LISTING_ID, listingFixture, profileFixture, progressFixture } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';
import ListingStepPage from './listings/[id]/[step]/page';
import ClosuresPage, { generateMetadata as closuresMetadata } from './listings/[id]/closures/page';
import OwnerLayout from './layout';
import OwnerTaxPage from './tax/page';

vi.mock('@/lib/owner.server', () => ({
  loadOwnerClosures: vi.fn(),
  loadOwnerListing: vi.fn(),
  loadOwnerProfile: vi.fn(),
  loadOtherListings: vi.fn(() => Promise.resolve([])),
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
  const [{ createTranslator }, { default: messages }] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
  ]);
  return {
    getTranslations: ({ namespace }: { namespace: string }) =>
      Promise.resolve(createTranslator({ locale: 'en', messages, namespace: namespace as never })),
  };
});

/** Inside the owner layout, as in the app: client components get only the owner namespaces. */
const renderInOwnerArea = async (page: ReactElement) =>
  renderWithProviders(<>{await OwnerLayout({ children: page })}</>);

const stepPage = async (step: string, listing?: Awaited<ReturnType<typeof loadOwnerListing>>) => {
  if (listing !== undefined) vi.mocked(loadOwnerListing).mockResolvedValue(listing);
  const params = Promise.resolve({ locale: 'en', id: LISTING_ID, step });
  return await renderInOwnerArea(await ListingStepPage({ params }));
};

type Other = OwnerOtherListings['listings'][number];
const other = (id: string, name: string, status: Other['status'] = 'draft'): Other => ({
  id,
  name,
  contentLocale: 'el',
  status,
});

const ready = progressFixture({ doneSteps: [...LISTING_STEPS], nextStep: 'review' });
const sendButton = () => screen.queryByRole('button', { name: 'Send for review' });

describe('a listing’s step page', () => {
  beforeEach(() => {
    vi.mocked(loadOwnerListing).mockReset();
    vi.mocked(notFound).mockClear();
    vi.mocked(requireSession).mockClear();
  });

  it('sends a stranger to sign in and back to this step', async () => {
    await stepPage('prices', listingFixture());
    expect(requireSession).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/prices`);
  });

  it('has no page for a step that doesn’t exist, and asks the API nothing', async () => {
    await expect(stepPage('nonsense')).rejects.toThrow('not found');
    expect(loadOwnerListing).not.toHaveBeenCalled();
  });

  it('treats a listing it can’t find as no page at all', async () => {
    await expect(stepPage('location', 'not-found')).rejects.toThrow('not found');
  });

  it('keeps an outage apart from a missing listing, with a heading to land on', async () => {
    await stepPage('location', 'unavailable');
    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });

  it('offers to send a listing with everything done', async () => {
    await stepPage(
      'review',
      listingFixture({ progress: ready, doneAccountSteps: ['profile', 'tax'] }),
    );
    expect(sendButton()).toBeInTheDocument();
  });

  it('holds it back while the owner’s own details are missing', async () => {
    await stepPage('review', listingFixture({ progress: ready, doneAccountSteps: ['profile'] }));
    expect(sendButton()).not.toBeInTheDocument();
  });

  it('holds it back while a step is unfinished', async () => {
    await stepPage(
      'review',
      listingFixture({
        progress: progressFixture({ doneSteps: ['location'], nextStep: 'spaces' }),
        doneAccountSteps: ['profile', 'tax'],
      }),
    );
    expect(sendButton()).not.toBeInTheDocument();
  });

  it('shows a locked listing as a summary, on every step, with nothing to change', async () => {
    const locked = listingFixture({
      status: 'in_review',
      locked: true,
      progress: { ...ready, status: 'in_review' },
      doneAccountSteps: ['profile', 'tax'],
    });
    await stepPage('prices', locked);
    expect(screen.getByText(/^You can’t change this listing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
    expect(sendButton()).not.toBeInTheDocument();
    // Closures are the one thing still open (decision #24).
    expect(screen.getByText(/^You can still set/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'closures and special hours' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/closures`,
    );
  });

  it('offers the week to the owner’s drafts and listings sent back, and to no other', async () => {
    vi.mocked(loadOtherListings).mockResolvedValueOnce([
      other('22222222-2222-4222-8222-222222222222', 'Πρόχειρο', 'draft'),
      other('33333333-3333-4333-8333-333333333333', 'Επιστράφηκε', 'changes_requested'),
      other('44444444-4444-4444-8444-444444444444', 'Σε έλεγχο', 'in_review'),
      other('55555555-5555-4555-8555-555555555555', 'Δημοσιευμένο', 'published'),
      other('66666666-6666-4666-8666-666666666666', 'Σε αναστολή', 'suspended'),
    ]);
    await stepPage('hours', listingFixture());
    // The API leaves this listing out; the page asks about this one.
    expect(loadOtherListings).toHaveBeenCalledWith(LISTING_ID);
    const offer = screen.getByRole('region', { name: 'Copy these hours to other listings' });
    expect(
      within(offer)
        .getAllByRole('checkbox')
        .map((box) => box.closest('div')?.textContent),
    ).toEqual(['All of these listings', 'Πρόχειρο', 'Επιστράφηκε']);
  });

  it('puts the closures sentence before the offer, outside its section', async () => {
    vi.mocked(loadOtherListings).mockResolvedValueOnce([
      other('22222222-2222-4222-8222-222222222222', 'Άλλο'),
    ]);
    await stepPage('hours', listingFixture());
    const offer = screen.getByRole('region', { name: 'Copy these hours to other listings' });
    const sentence = screen.getByText(/^Closed on holidays/);
    expect(offer).not.toContainElement(sentence);
    expect(sentence.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for the owner’s other listings only on the hours step', async () => {
    vi.mocked(loadOtherListings).mockClear();
    await stepPage('prices', listingFixture());
    expect(loadOtherListings).not.toHaveBeenCalled();
  });

  it('points from the weekly hours to closures and special hours', async () => {
    await stepPage('hours', listingFixture());
    expect(screen.getByText(/^Closed on holidays/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set closures and special hours' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/closures`,
    );
  });
});

describe('the closures page', () => {
  type Closures = Awaited<ReturnType<typeof loadOwnerClosures>>;
  const closures = (overrides: Partial<Exclude<Closures, string>> = {}): Closures => ({
    id: LISTING_ID,
    name: 'Garage on Ermou',
    contentLocale: 'en',
    exceptions: [],
    ...overrides,
  });
  const page = async (listing?: Closures) => {
    if (listing !== undefined) vi.mocked(loadOwnerClosures).mockResolvedValue(listing);
    const params = Promise.resolve({ locale: 'en', id: LISTING_ID });
    return renderInOwnerArea(await ClosuresPage({ params }));
  };

  beforeEach(() => {
    vi.mocked(loadOwnerClosures).mockReset();
    vi.mocked(loadOtherListings).mockClear();
    vi.mocked(requireSession).mockClear();
  });

  it('sends a stranger to sign in and back here', async () => {
    await page(closures());
    expect(requireSession).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/closures`);
  });

  it('can be changed on a live listing, which the steps can’t', async () => {
    // The page reads no status: closures can be changed at any (decision #24).
    const live = closures({
      name: 'Γκαράζ Ερμού',
      contentLocale: 'el',
      exceptions: [
        {
          label: 'Χριστούγεννα',
          startsOn: '2099-12-25',
          endsOn: '2099-12-25',
          hours: null,
          closedHours: null,
        },
      ],
    });
    await page(live);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Closures and special hours' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    expect(screen.getByLabelText('First day')).toHaveValue('2099-12-25');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your parking' })).toHaveAttribute(
      'href',
      '/en/owner',
    );
  });

  it('treats a listing it can’t find as no page at all', async () => {
    await expect(page('not-found')).rejects.toThrow('not found');
  });

  it('marks the Greek words in an English listing’s name, and leaves an unnamed one ours', async () => {
    const named = await page(closures({ name: 'Garage on Οδός Ερμού' }));
    const greek = screen.getByText('Οδός Ερμού');
    expect(greek).toHaveAttribute('lang', 'el');
    expect(greek.parentElement).toHaveAttribute('lang', 'en');
    named.unmount();
    await page(closures({ name: null }));
    expect(screen.getByText('Unnamed listing')).not.toHaveAttribute('lang');
  });

  it('names the listing in the page title, and only the page otherwise', async () => {
    const title = async (listing: Closures, locale = 'en') => {
      vi.mocked(loadOwnerClosures).mockResolvedValue(listing);
      const params = Promise.resolve({ locale, id: LISTING_ID });
      return (await closuresMetadata({ params })).title;
    };
    expect(await title(closures({ name: 'Γκαράζ Ερμού' }))).toBe(
      'Closures and special hours: Γκαράζ Ερμού',
    );
    expect(await title(closures({ name: null }))).toBe('Closures and special hours');
    // Another owner's listing looks like a missing one, and its name never reaches the title.
    expect(await title('not-found')).toBe('Closures and special hours');
    expect(await title('unavailable')).toBe('Closures and special hours');
  });

  it('offers the owner’s other listings to copy to, whatever their status', async () => {
    vi.mocked(loadOtherListings).mockResolvedValueOnce([
      other('22222222-2222-4222-8222-222222222222', 'Γκαράζ Πειραιά', 'published'),
      other('33333333-3333-4333-8333-333333333333', 'Γκαράζ Βόλου', 'draft'),
    ]);
    const christmas = {
      label: null,
      startsOn: '2099-12-25',
      endsOn: '2099-12-25',
      hours: null,
      closedHours: null,
    };
    await page(closures({ exceptions: [christmas] }));
    expect(loadOtherListings).toHaveBeenCalledWith(LISTING_ID);
    expect(
      screen.getByRole('heading', { name: 'Copy to your other listings' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Γκαράζ Βόλου' })).toBeInTheDocument();
  });

  it('still works without the list of other listings', async () => {
    await page(closures());
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Copy to your other listings' }),
    ).not.toBeInTheDocument();
  });

  it('explains an outage, with a heading to land on', async () => {
    await page('unavailable');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Closures and special hours',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });
});

describe('the tax page', () => {
  const params = Promise.resolve({ locale: 'en' });
  const page = async () => renderInOwnerArea(await OwnerTaxPage({ params }));

  it('asks who the owner is first, since that decides what it needs', async () => {
    vi.mocked(loadOwnerProfile).mockResolvedValue(profileFixture({ kind: null }));
    await page();
    expect(screen.getByRole('link', { name: 'Go to About you' })).toHaveAttribute(
      'href',
      '/en/owner/profile',
    );
    expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
  });

  it('shows the form once it knows', async () => {
    vi.mocked(loadOwnerProfile).mockResolvedValue(profileFixture({ kind: 'individual' }));
    await page();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeInTheDocument();
  });

  it('explains an outage rather than an empty page', async () => {
    vi.mocked(loadOwnerProfile).mockResolvedValue(null);
    await page();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });
});
