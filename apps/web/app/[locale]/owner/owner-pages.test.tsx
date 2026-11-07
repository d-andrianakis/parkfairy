import { LISTING_STEPS, type OwnerListingProgress } from '@parkfairy/contracts';
import { screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnerListing, loadOwnerOnboarding, loadOwnerProfile } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';
import { LISTING_ID, listingFixture, profileFixture, progressFixture } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';
import ListingStepPage from './listings/[id]/[step]/page';
import ClosuresPage from './listings/[id]/closures/page';
import OwnerTaxPage from './tax/page';

vi.mock('@/lib/owner.server', () => ({
  loadOwnerListing: vi.fn(),
  loadOwnerOnboarding: vi.fn(() => Promise.resolve(null)),
  loadOwnerProfile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
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

const stepPage = async (step: string, listing?: Awaited<ReturnType<typeof loadOwnerListing>>) => {
  if (listing !== undefined) vi.mocked(loadOwnerListing).mockResolvedValue(listing);
  const params = Promise.resolve({ locale: 'en', id: LISTING_ID, step });
  return renderWithProviders(await ListingStepPage({ params }));
};

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
    const other = (id: string, name: string, status: OwnerListingProgress['status']) =>
      progressFixture({ id, name, status });
    vi.mocked(loadOwnerOnboarding).mockResolvedValueOnce({
      started: true,
      doneAccountSteps: [],
      listings: [
        progressFixture({ name: 'Αυτό εδώ' }),
        other('22222222-2222-4222-8222-222222222222', 'Πρόχειρο', 'draft'),
        other('33333333-3333-4333-8333-333333333333', 'Επιστράφηκε', 'changes_requested'),
        other('44444444-4444-4444-8444-444444444444', 'Σε έλεγχο', 'in_review'),
        other('55555555-5555-4555-8555-555555555555', 'Δημοσιευμένο', 'published'),
        other('66666666-6666-4666-8666-666666666666', 'Σε αναστολή', 'suspended'),
      ],
    });
    await stepPage('hours', listingFixture());
    const offer = screen.getByRole('region', { name: 'Copy these hours to other listings' });
    expect(
      within(offer)
        .getAllByRole('checkbox')
        .map((box) => box.closest('div')?.textContent),
    ).toEqual(['All of these listings', 'Πρόχειρο', 'Επιστράφηκε']);
  });

  it('puts the closures sentence before the offer, outside its section', async () => {
    vi.mocked(loadOwnerOnboarding).mockResolvedValueOnce({
      started: true,
      doneAccountSteps: [],
      listings: [progressFixture({ id: '22222222-2222-4222-8222-222222222222', name: 'Άλλο' })],
    });
    await stepPage('hours', listingFixture());
    const offer = screen.getByRole('region', { name: 'Copy these hours to other listings' });
    const sentence = screen.getByText(/^Closed on holidays/);
    expect(offer).not.toContainElement(sentence);
    expect(sentence.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for the owner’s other listings only on the hours step', async () => {
    vi.mocked(loadOwnerOnboarding).mockClear();
    await stepPage('prices', listingFixture());
    expect(loadOwnerOnboarding).not.toHaveBeenCalled();
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
  const page = async (listing?: Awaited<ReturnType<typeof loadOwnerListing>>) => {
    if (listing !== undefined) vi.mocked(loadOwnerListing).mockResolvedValue(listing);
    const params = Promise.resolve({ locale: 'en', id: LISTING_ID });
    return renderWithProviders(await ClosuresPage({ params }));
  };

  beforeEach(() => {
    vi.mocked(loadOwnerListing).mockReset();
    vi.mocked(requireSession).mockClear();
  });

  it('sends a stranger to sign in and back here', async () => {
    await page(listingFixture());
    expect(requireSession).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/closures`);
  });

  it('can be changed on a live listing, which the steps can’t', async () => {
    const live = listingFixture({
      status: 'published',
      locked: true,
      location: { ...listingFixture().location, name: 'Γκαράζ Ερμού', contentLocale: 'el' },
      hoursExceptions: [
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

  it('offers the owner’s other listings to copy to, never this one', async () => {
    vi.mocked(loadOwnerOnboarding).mockResolvedValueOnce({
      started: true,
      doneAccountSteps: [],
      listings: [
        progressFixture({ name: 'Αυτό εδώ' }),
        progressFixture({ id: '22222222-2222-4222-8222-222222222222', name: 'Γκαράζ Πειραιά' }),
      ],
    });
    const christmas = {
      label: null,
      startsOn: '2099-12-25',
      endsOn: '2099-12-25',
      hours: null,
      closedHours: null,
    };
    await page(listingFixture({ hoursExceptions: [christmas] }));
    expect(
      screen.getByRole('heading', { name: 'Copy to your other listings' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Αυτό εδώ' })).not.toBeInTheDocument();
  });

  it('still works without the list of other listings', async () => {
    await page(listingFixture());
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
  const page = async () => renderWithProviders(await OwnerTaxPage({ params }));

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
