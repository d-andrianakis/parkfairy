import type { OwnerListingProgress, OwnerOnboarding } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import { isListingStep, listingStepHref, nextOwnerAction, setupProgress } from './owner';

const listing = (overrides: Partial<OwnerListingProgress> = {}): OwnerListingProgress => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Γκαράζ',
  contentLocale: 'el',
  status: 'draft',
  slug: null,
  coverPhoto: null,
  doneSteps: [],
  nextStep: 'location',
  reviewNote: null,
  submittedAt: null,
  updatedAt: '2027-01-01T00:00:00.000Z',
  ...overrides,
});

const onboarding = (overrides: Partial<OwnerOnboarding> = {}): OwnerOnboarding => ({
  started: true,
  doneAccountSteps: ['profile', 'tax'],
  listings: [],
  ...overrides,
});

describe('nextOwnerAction', () => {
  it('starts with the first account step', () => {
    expect(nextOwnerAction(onboarding({ doneAccountSteps: [] }))).toEqual({
      kind: 'account',
      step: 'profile',
      href: '/owner/profile',
    });
  });

  it('goes to the tax step once the profile is done', () => {
    expect(nextOwnerAction(onboarding({ doneAccountSteps: ['profile'] }))).toMatchObject({
      kind: 'account',
      step: 'tax',
    });
  });

  it('invites a first listing when the account is done', () => {
    expect(nextOwnerAction(onboarding())).toEqual({ kind: 'newListing' });
  });

  it('opens a draft’s first unfinished step', () => {
    const draft = listing({ nextStep: 'photos' });
    expect(nextOwnerAction(onboarding({ listings: [draft] }))).toMatchObject({
      kind: 'listing',
      step: 'photos',
      href: `/owner/listings/${draft.id}/photos`,
    });
  });

  it('puts a listing sent back ahead of everything', () => {
    const sentBack = listing({ status: 'changes_requested', nextStep: 'review' });
    const action = nextOwnerAction(
      onboarding({ doneAccountSteps: [], listings: [listing(), sentBack] }),
    );
    expect(action).toMatchObject({ kind: 'listing', step: 'review', listing: sentBack });
  });

  it('puts the account ahead of a draft, because submitting needs it', () => {
    const action = nextOwnerAction(onboarding({ doneAccountSteps: [], listings: [listing()] }));
    expect(action.kind).toBe('account');
  });

  it('has nothing to do while staff have everything', () => {
    const waiting = listing({ status: 'in_review', nextStep: null });
    expect(nextOwnerAction(onboarding({ listings: [waiting] }))).toEqual({ kind: 'done' });
  });

  it('has nothing to do once listings are live', () => {
    const live = listing({ status: 'published', nextStep: null });
    expect(nextOwnerAction(onboarding({ listings: [live] }))).toEqual({ kind: 'done' });
  });
});

describe('setupProgress', () => {
  it('starts with the confirmed address already counted', () => {
    expect(setupProgress([], undefined)).toEqual({ done: 1, total: 10, percent: 10 });
  });

  it('counts the account and the listing', () => {
    const halfway = listing({ doneSteps: ['location', 'spaces', 'hours'] });
    expect(setupProgress(['profile', 'tax'], halfway)).toEqual({
      done: 6,
      total: 10,
      percent: 60,
    });
  });

  it('reaches all of it once submitted', () => {
    const submitted = listing({
      doneSteps: ['location', 'spaces', 'hours', 'prices', 'photos', 'proof', 'review'],
    });
    expect(setupProgress(['profile', 'tax'], submitted).percent).toBe(100);
  });
});

describe('steps', () => {
  it('builds step links', () => {
    expect(listingStepHref('abc', 'photos')).toBe('/owner/listings/abc/photos');
  });

  it('recognises real steps only', () => {
    expect(isListingStep('photos')).toBe(true);
    expect(isListingStep('nonsense')).toBe(false);
    expect(isListingStep('__proto__')).toBe(false);
  });
});
