import { isListingSlug, LISTING_LIMITS } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import { slugFromName } from './slug.js';

describe('slugFromName', () => {
  it('writes Greek names in Latin letters', () => {
    expect(slugFromName('Γκαράζ Σκουφά')).toBe('garaz-skoufa');
    expect(slugFromName('Πάρκινγκ Ερμού')).toBe('parking-ermou');
    expect(slugFromName('Πλατεία Ευαγγελισμού')).toBe('plateia-evaggelismou');
  });

  it('keeps Latin names and digits', () => {
    expect(slugFromName('Park & Fly 24')).toBe('park-fly-24');
  });

  it('never leaves a stray hyphen', () => {
    expect(slugFromName('  --Γκαράζ!!  ')).toBe('garaz');
  });

  it('never takes a name the API routes use', () => {
    expect(slugFromName('Search')).toBe('parking-search');
    expect(slugFromName('Featured')).toBe('parking-featured');
  });

  it('never looks like a draft', () => {
    expect(slugFromName('Draft Garage')).toBe('parking-draft-garage');
  });

  it('falls back when nothing survives', () => {
    expect(slugFromName('¡¡¡')).toBe('parking');
    expect(slugFromName('')).toBe('parking');
  });

  it('stays a valid slug with room for a suffix, however long the name', () => {
    const slug = slugFromName('Γκαράζ '.repeat(40));
    expect(isListingSlug(slug)).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(LISTING_LIMITS.slug - 9);
  });
});
