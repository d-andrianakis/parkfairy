import { describe, expect, it } from 'vitest';

import {
  ADMIN_ERROR_CODES,
  ADMIN_IDENTITY_NOTE_MAX,
  ADMIN_PAGE_SIZE,
  ADMIN_REASON_NOTE_MAX,
  AdminAuditQuerySchema,
  AdminBookingLookupSchema,
  AdminBookingSchema,
  AdminChangesInputSchema,
  adminCursor,
  AdminDisputeDecisionInputSchema,
  AdminListingReviewSchema,
  AdminOwnerSchema,
  AdminPaymentsSchema,
  AdminQueueQuerySchema,
  AdminQueueSchema,
  AdminReasonInputSchema,
  AdminRemoveTwoFactorInputSchema,
  AdminSuspendListingInputSchema,
  AdminUserLookupSchema,
  AdminUserSchema,
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  AuditEntrySchema,
} from './admin.js';
import { bookingsCursor } from './bookings.js';
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
  canSuspend: false,
  canReinstate: false,
  upcomingBookings: 0,
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
    expect(AuditEntrySchema.safeParse({ ...entry, targetType: 'payout' }).success).toBe(false);
    expect(AuditEntrySchema.safeParse({ ...entry, targetType: 'user' }).success).toBe(true);
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
    for (const code of ['USER_NOT_FOUND', 'OWN_ACCOUNT', 'STAFF_ACCOUNT', 'NO_TWO_FACTOR']) {
      expect(ADMIN_ERROR_CODES).toContain(code);
    }
  });
});

describe('support and accounts (#13)', () => {
  it('logs the removal of a second factor, against a user', () => {
    expect(AUDIT_ACTIONS).toContain('user.two_factor_removed');
    expect(AUDIT_ACTIONS).toContain('user.viewed');
    expect(AUDIT_TARGETS).toContain('user');
  });

  it('finds an account by one whole address, trimmed and in lower case', () => {
    expect(AdminUserLookupSchema.parse({ email: '  Eleni@Example.GR ' }).email).toBe(
      'eleni@example.gr',
    );
    for (const email of [
      '',
      'eleni',
      '%@example.gr',
      'eleni@',
      'a@b.gr, c@d.gr',
      `${'a'.repeat(250)}@example.gr`,
      42,
      ['a@example.gr', 'b@example.gr'],
    ]) {
      const result = AdminUserLookupSchema.safeParse({ email });
      expect(result.success, JSON.stringify(email)).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        expect(isValidationMessage(issue.message)).toBe(true);
      }
    }
  });

  it('shows an account by its facts and how it is secured, no more', () => {
    expect(Object.keys(AdminUserSchema.shape).sort()).toEqual(
      [
        'canRemoveTwoFactor',
        'canReinstate',
        'canSuspend',
        'liveListings',
        'suspended',
        'createdAt',
        'email',
        'emailVerified',
        'id',
        'locale',
        'name',
        'own',
        'role',
        'twoFactorEnabled',
      ].sort(),
    );
  });

  it('wants a plain note on how the person was identified, kept short for the log', () => {
    expect(AdminRemoveTwoFactorInputSchema.parse({ note: '  Call, ticket 12  ' }).note).toBe(
      'Call, ticket 12',
    );
    expect(
      AdminRemoveTwoFactorInputSchema.safeParse({ note: 'x'.repeat(ADMIN_IDENTITY_NOTE_MAX) })
        .success,
    ).toBe(true);
    expect(ADMIN_IDENTITY_NOTE_MAX).toBeLessThanOrEqual(100);
    // Nothing that reads differently from what is written: control, bidi, zero-width, invisible
    // and separator characters, each by its code point.
    const hidden = [0x0, 0x7, 0xad, 0x61c, 0x200b, 0x200e, 0x2028, 0x2029, 0x202e, 0x2060, 0x2066]
      .concat([0x3164, 0xfeff, 0xe0041])
      .map((point) => `a${String.fromCodePoint(point)}b`);
    for (const note of ['', '   ', 'x'.repeat(ADMIN_IDENTITY_NOTE_MAX + 1), ...hidden]) {
      expect(
        AdminRemoveTwoFactorInputSchema.safeParse({ note }).success,
        JSON.stringify(note),
      ).toBe(false);
    }
    expect(AdminRemoveTwoFactorInputSchema.safeParse({ note: 'ok', extra: 1 }).success).toBe(false);
  });

  it('keeps a Greek note, with its accents, in one Unicode form', () => {
    const decomposed = 'Ελένη'.normalize('NFD');
    const { note } = AdminRemoveTwoFactorInputSchema.parse({ note: decomposed });
    expect(note).toBe('Ελένη'.normalize('NFC'));
    expect(note).not.toBe(decomposed);
  });
});

describe('moderation (#78–#81)', () => {
  it('logs the four actions, each filterable', () => {
    for (const action of [
      'listing.suspended',
      'listing.reinstated',
      'user.suspended',
      'user.reinstated',
    ]) {
      expect(AdminAuditQuerySchema.parse({ action }).action).toBe(action);
    }
  });

  it('wants a listing’s suspension to say why, for its owners, and what becomes of the bookings', () => {
    const ok = { note: '  The deed shows another owner.  ', cancelBookings: false };
    expect(AdminSuspendListingInputSchema.parse(ok)).toEqual({
      note: 'The deed shows another owner.',
      cancelBookings: false,
    });
    expect(
      AdminSuspendListingInputSchema.safeParse({
        note: 'x'.repeat(OWNER_LIMITS.reviewNote),
        cancelBookings: true,
      }).success,
    ).toBe(true);
    const hidden = [0x0, 0xad, 0x202e, 0x2028, 0x3164].map(
      (point) => `a${String.fromCodePoint(point)}b`,
    );
    for (const bad of [
      {},
      { note: 'Why.' },
      { cancelBookings: true },
      { note: '', cancelBookings: true },
      { note: 'x'.repeat(OWNER_LIMITS.reviewNote + 1), cancelBookings: true },
      { note: 'Why.', cancelBookings: 'yes' },
      { note: 'Why.', cancelBookings: 1 },
      { note: 'Why.', cancelBookings: true, extra: 1 },
      ...hidden.map((note) => ({ note, cancelBookings: false })),
    ]) {
      const result = AdminSuspendListingInputSchema.safeParse(bad);
      expect(result.success, JSON.stringify(bad)).toBe(false);
      // Every refusal a person can meet is a key the screens translate (an unknown key is a
      // client of ours that is wrong, not a person).
      if (!('extra' in bad)) {
        for (const issue of result.error?.issues ?? []) {
          expect(isValidationMessage(issue.message)).toBe(true);
        }
      }
    }
  });

  it('keeps a note for the log alone short, in plain words', () => {
    expect(ADMIN_REASON_NOTE_MAX).toBeLessThanOrEqual(100);
    expect(AdminReasonInputSchema.parse({ note: ' Ticket 4821. ' }).note).toBe('Ticket 4821.');
    for (const bad of [
      {},
      { note: '' },
      { note: 'x'.repeat(ADMIN_REASON_NOTE_MAX + 1) },
      { note: 'Why.', cancelBookings: true },
      { note: `a${String.fromCodePoint(0x202e)}b` },
    ]) {
      expect(AdminReasonInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('names the codes the moderation routes answer with', () => {
    for (const code of ['NOT_PUBLISHED', 'NOT_SUSPENDED', 'ALREADY_SUSPENDED']) {
      expect(ADMIN_ERROR_CODES).toContain(code);
    }
  });
});

describe('bookings and payments (#82–#85)', () => {
  it('logs the five actions, each filterable', () => {
    for (const action of [
      'booking.viewed',
      'booking.cancelled',
      'booking.refund_retried',
      'booking.refund_settled',
      'dispute.decided',
    ]) {
      expect(AdminAuditQuerySchema.parse({ action }).action).toBe(action);
    }
    expect(AUDIT_TARGETS).toEqual(expect.arrayContaining(['booking', 'dispute']));
  });

  it('finds a booking by its reference alone, trimmed and in capitals', () => {
    expect(AdminBookingLookupSchema.parse({ reference: ' k7m4-q2zd ' }).reference).toBe(
      'K7M4-Q2ZD',
    );
    for (const reference of ['', 'K7M4Q2ZD', 'K7M4-Q2Z', 'K7M4-Q2ZDD', 'K7M4-Q2ZU', 42, null]) {
      expect(AdminBookingLookupSchema.safeParse({ reference }).success, String(reference)).toBe(
        false,
      );
    }
    expect(AdminBookingLookupSchema.safeParse({ reference: 'K7M4-Q2ZD', extra: 1 }).success).toBe(
      false,
    );
  });

  it('says who bears a lost dispute, one of two, with a short note', () => {
    for (const decision of ['parkfairy_bears', 'owners_bear']) {
      expect(AdminDisputeDecisionInputSchema.parse({ decision, note: ' Ticket 1. ' })).toEqual({
        decision,
        note: 'Ticket 1.',
      });
    }
    for (const bad of [
      {},
      { note: 'Ticket 1.' },
      { decision: 'owners_bear' },
      { decision: 'both', note: 'Ticket 1.' },
      { decision: 'owners_bear', note: '' },
      { decision: 'owners_bear', note: 'x'.repeat(ADMIN_REASON_NOTE_MAX + 1) },
      { decision: 'owners_bear', note: 'Ticket 1.', extra: 1 },
    ]) {
      expect(AdminDisputeDecisionInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it('gives a booking with who booked it, its money and its disputes, and the lists a cap', () => {
    expect(Object.keys(AdminBookingSchema.shape)).toEqual(
      expect.arrayContaining([
        'driver',
        'vehiclePlate',
        'total',
        'refund',
        'disputes',
        'canCancel',
        'canRetryRefund',
        'canSettleRefund',
      ]),
    );
    const empty = {
      lostDisputes: [],
      openDisputes: [],
      failedRefunds: [],
      more: { lostDisputes: false, openDisputes: false, failedRefunds: false },
    };
    expect(AdminPaymentsSchema.parse(empty)).toEqual(empty);
  });

  it('names the codes the booking and payment routes answer with', () => {
    for (const code of [
      'BOOKING_NOT_FOUND',
      'NOT_CANCELLABLE',
      'REFUND_NOT_FAILED',
      'TRANSFER_MADE',
      'DISPUTE_NOT_FOUND',
      'NOT_LOST',
      'ALREADY_DECIDED',
    ]) {
      expect(ADMIN_ERROR_CODES).toContain(code);
    }
  });
});
