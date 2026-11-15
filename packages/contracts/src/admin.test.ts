import { describe, expect, it } from 'vitest';
import { bookingsCursor } from './bookings.js';
import {
  ADMIN_ERROR_CODES,
  ADMIN_PAGE_SIZE,
  adminCursor,
  AdminAuditQuerySchema,
  AdminChangesInputSchema,
  AdminListingReviewSchema,
  AdminOwnerSchema,
  AdminQueueQuerySchema,
  AdminQueueSchema,
  AUDIT_ACTIONS,
  AuditEntrySchema,
} from './admin.js';
import { OWNER_LIMITS } from './owner.js';
import { isValidationMessage } from './validation.js';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const owner = {
  role: 'primary' as const,
  accountName: 'Maria',
  kind: 'individual' as const,
  firstName: 'Maria',
  lastName: 'Papadopoulou',
  legalName: null,
  country: 'GR',
  taxCountry: 'GR',
  taxIdEnding: '216',
  vatIdEnding: null,
  registrationEnding: null,
  verification: 'pending' as const,
  sharePercent: 100,
  detailsComplete: true,
};
const review = {
  id: ID,
  status: 'in_review' as const,
  name: 'Γκαράζ Ερμού',
  description: null,
  address: 'Ερμού 1, Αθήνα',
  areaId: 'syntagma' as const,
  contentLocale: 'el' as const,
  landRegistrationNumber: null,
  hourlyRate: { amountMinor: 200, currency: 'EUR' as const },
  spaces: ['A1'],
  photos: 3,
  submittedAt: '2026-11-15T10:00:00.000Z',
  reviewNote: null,
  owners: [owner],
  proofs: [
    {
      id: ID,
      kind: 'lease' as const,
      fileName: 'lease.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      createdAt: '2026-11-15T09:00:00.000Z',
    },
  ],
  canDecide: true,
  own: false,
};

describe('the review queue query', () => {
  it('starts with what is waiting, and takes another status or a place a page gave out', () => {
    expect(AdminQueueQuerySchema.parse({})).toEqual({ status: 'in_review' });
    const place = adminCursor(new Date('2026-11-15T10:00:00Z'), ID);
    expect(place).toBe(bookingsCursor({ start: new Date('2026-11-15T10:00:00Z'), id: ID }));
    expect(AdminQueueQuerySchema.parse({ status: 'published', after: place })).toEqual({
      status: 'published',
      after: place,
    });
  });

  it('refuses a draft, a status that is not one and a place no page gave out', () => {
    for (const query of [
      { status: 'draft' },
      { status: 'gone' },
      { after: 'later' },
      { after: '' },
    ]) {
      const result = AdminQueueQuerySchema.safeParse(query);
      expect(result.success, JSON.stringify(query)).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(isValidationMessage(issue.message)).toBe(true);
      }
    }
  });
});

describe('the queue and the log', () => {
  it('carry a page at most', () => {
    const item = {
      id: ID,
      status: 'in_review' as const,
      name: null,
      address: null,
      contentLocale: 'el' as const,
      owner: 'Maria',
      submittedAt: null,
    };
    const many = (count: number) => Array.from({ length: count }, () => item);
    expect(
      AdminQueueSchema.safeParse({ listings: many(ADMIN_PAGE_SIZE), next: null }).success,
    ).toBe(true);
    expect(
      AdminQueueSchema.safeParse({ listings: many(ADMIN_PAGE_SIZE + 1), next: null }).success,
    ).toBe(false);
  });

  it('filter the log by one of the actions staff can take', () => {
    for (const action of AUDIT_ACTIONS)
      expect(AdminAuditQuerySchema.parse({ action }).action).toBe(action);
    expect(AdminAuditQuerySchema.safeParse({ action: 'user.deleted' }).success).toBe(false);
  });

  it('describe an entry with ids and short words, no more', () => {
    const entry = {
      id: ID,
      at: '2026-11-15T10:00:00.000Z',
      action: 'listing.changes_requested' as const,
      actor: { id: ID, name: 'Staff', email: 'staff@example.gr' },
      targetType: 'listing' as const,
      targetId: ID,
      details: { noteLength: 42, status: 'in_review' },
    };
    expect(AuditEntrySchema.parse(entry)).toEqual(entry);
    expect(AuditEntrySchema.safeParse({ ...entry, details: { nested: { a: 1 } } }).success).toBe(
      false,
    );
    expect(AuditEntrySchema.safeParse({ ...entry, targetType: 'user' }).success).toBe(false);
  });
});

describe('a listing as staff review it', () => {
  it('reads what the API answers', () => {
    expect(AdminListingReviewSchema.parse(review)).toEqual(review);
  });

  it('shows tax values as three characters at most, never whole (#67)', () => {
    expect(AdminOwnerSchema.safeParse({ ...owner, taxIdEnding: '094259216' }).success).toBe(false);
    expect(AdminOwnerSchema.safeParse({ ...owner, vatIdEnding: 'EL0942' }).success).toBe(false);
    expect(AdminOwnerSchema.safeParse({ ...owner, registrationEnding: '12345' }).success).toBe(
      false,
    );
    // And has no field for a birth date, a phone or an address at all.
    const parsed = AdminOwnerSchema.parse({
      ...owner,
      birthDate: '1980-02-03',
      phone: '+30 210 123 4567',
      addressLine: 'Ερμού 1',
    });
    expect(parsed).not.toHaveProperty('birthDate');
    expect(parsed).not.toHaveProperty('phone');
    expect(parsed).not.toHaveProperty('addressLine');
  });
});

describe('what staff ask to have changed', () => {
  it('is plain words for the owner, not empty and not past the owner-note limit', () => {
    expect(AdminChangesInputSchema.parse({ note: '  Add a photo of the entrance.  ' }).note).toBe(
      'Add a photo of the entrance.',
    );
    expect(AdminChangesInputSchema.parse({ note: 'One.\nTwo.' }).note).toBe('One.\nTwo.');
    expect(
      AdminChangesInputSchema.safeParse({ note: 'x'.repeat(OWNER_LIMITS.reviewNote) }).success,
    ).toBe(true);
    for (const note of [
      '',
      '   ',
      'x'.repeat(OWNER_LIMITS.reviewNote + 1),
      'a\u0000b',
      'a\u202eb',
      'a\u200bb',
      'a\u2066b',
    ]) {
      const result = AdminChangesInputSchema.safeParse({ note });
      expect(result.success, JSON.stringify(note)).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(isValidationMessage(issue.message)).toBe(true);
      }
    }
    expect(AdminChangesInputSchema.safeParse({ note: 'ok', extra: 1 }).success).toBe(false);
  });

  it('names every code an admin route answers with, each once', () => {
    expect(new Set(ADMIN_ERROR_CODES).size).toBe(ADMIN_ERROR_CODES.length);
    expect(ADMIN_ERROR_CODES).toContain('NOT_IN_REVIEW');
    expect(ADMIN_ERROR_CODES).toContain('OWN_LISTING');
  });
});
