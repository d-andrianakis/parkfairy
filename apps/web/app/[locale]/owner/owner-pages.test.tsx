import { LISTING_STEPS } from '@parkfairy/contracts';
import { screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnerListing, loadOwnerProfile } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';
import { LISTING_ID, listingFixture, profileFixture, progressFixture } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';
import ListingStepPage from './listings/[id]/[step]/page';
import OwnerTaxPage from './tax/page';

vi.mock('@/lib/owner.server', () => ({ loadOwnerListing: vi.fn(), loadOwnerProfile: vi.fn() }));
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
