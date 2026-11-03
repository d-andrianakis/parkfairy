import { describe, expect, it } from 'vitest';
import {
  doneAccountSteps,
  doneListingSteps,
  missingForSubmit,
  nextListingStep,
  type ListingFacts,
  type ProfileFacts,
} from './onboarding-progress.js';

const individual: ProfileFacts = {
  kind: 'individual',
  firstName: 'Μαρία',
  lastName: 'Παπαδοπούλου',
  legalName: null,
  phone: '+30 210 000 0000',
  addressLine: 'Ερμού 1',
  city: 'Αθήνα',
  postalCode: '105 63',
  country: 'GR',
  hasTaxId: true,
  hasBirthDate: true,
  hasRegistrationNumber: false,
};

const complete: ListingFacts = {
  status: 'draft',
  location: {
    name: 'Γκαράζ',
    address: 'Ερμού 1',
    areaId: 'syntagma',
    latitude: 37.97,
    longitude: 23.73,
    contentLocale: 'el',
  },
  hourlyRateMinor: 300,
  cancellationPolicy: 'oneDay',
  spaces: 3,
  openingPeriods: 7,
  photos: 1,
  proofs: 1,
};

describe('account steps', () => {
  it('has nothing done before a profile exists', () => {
    expect(doneAccountSteps(undefined)).toEqual([]);
  });

  it('finishes both steps for a complete individual', () => {
    expect(doneAccountSteps(individual)).toEqual(['profile', 'tax']);
  });

  it('reopens a step when a required field goes missing', () => {
    expect(doneAccountSteps({ ...individual, phone: null })).toEqual(['tax']);
  });

  it('asks individuals for a birth date, not a registration number', () => {
    expect(doneAccountSteps({ ...individual, hasBirthDate: false })).toEqual(['profile']);
  });

  it('asks businesses for a legal name and registration number, not a birth date', () => {
    const business: ProfileFacts = {
      ...individual,
      kind: 'business',
      firstName: null,
      lastName: null,
      legalName: 'Παρκινγκ ΑΕ',
      hasBirthDate: false,
      hasRegistrationNumber: true,
    };
    expect(doneAccountSteps(business)).toEqual(['profile', 'tax']);
    expect(doneAccountSteps({ ...business, legalName: null })).toEqual(['tax']);
    expect(doneAccountSteps({ ...business, hasRegistrationNumber: false })).toEqual(['profile']);
  });

  it('leaves tax undone until the kind is known', () => {
    expect(doneAccountSteps({ ...individual, kind: null })).toEqual([]);
  });
});

describe('listing steps', () => {
  it('counts every step but review on a complete draft', () => {
    expect(doneListingSteps(complete)).toEqual([
      'location',
      'spaces',
      'hours',
      'prices',
      'photos',
      'proof',
    ]);
  });

  it('marks review done once staff have the listing', () => {
    expect(doneListingSteps({ ...complete, status: 'in_review' })).toContain('review');
    expect(doneListingSteps({ ...complete, status: 'published' })).toContain('review');
  });

  it('reopens review when a listing is sent back', () => {
    expect(doneListingSteps({ ...complete, status: 'changes_requested' })).not.toContain('review');
  });

  it('needs a real point in Greece for the location step', () => {
    const facts = { ...complete, location: { ...complete.location, latitude: 52.5 } };
    expect(doneListingSteps(facts)).not.toContain('location');
  });

  it('needs both the rate and a cancellation policy for the prices step', () => {
    expect(doneListingSteps({ ...complete, hourlyRateMinor: null })).not.toContain('prices');
    expect(doneListingSteps({ ...complete, cancellationPolicy: null })).not.toContain('prices');
  });
});

describe('where Continue goes', () => {
  it('opens the first step not done, whatever was done after it', () => {
    expect(nextListingStep('draft', ['location', 'photos'])).toBe('spaces');
  });

  it('opens review when only that is left', () => {
    const done = doneListingSteps(complete);
    expect(nextListingStep('draft', done)).toBe('review');
    expect(nextListingStep('changes_requested', done)).toBe('review');
  });

  it('goes nowhere while staff have the listing or once it is live', () => {
    expect(nextListingStep('in_review', [])).toBeNull();
    expect(nextListingStep('published', [])).toBeNull();
    expect(nextListingStep('suspended', [])).toBeNull();
  });
});

describe('what a submission needs', () => {
  it('needs nothing when every step is done', () => {
    expect(missingForSubmit(doneListingSteps(complete), ['profile', 'tax'])).toEqual([]);
  });

  it('names what is missing, on the account first', () => {
    expect(missingForSubmit(['location'], ['profile'])).toEqual([
      'tax',
      'spaces',
      'hours',
      'prices',
      'photos',
      'proof',
    ]);
  });
});
