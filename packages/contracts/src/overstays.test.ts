import { describe, expect, it } from 'vitest';

import { ADMIN_PAGE_SIZE, AUDIT_ACTIONS } from './admin.js';
import {
  AdminOverstaySchema,
  AdminOverstaysQuerySchema,
  AdminOverstaysSchema,
  OVERSTAY_ERROR_CODES,
  OVERSTAY_NOTE_MAX,
  OVERSTAY_REPORT_DAYS,
  OVERSTAY_STATUSES,
  OverstayReportInputSchema,
  OwnerOverstaySchema,
} from './overstays.js';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const PLACE = `1700000000000_${ID}`;

describe('an overstay report from an owner (5.2c4)', () => {
  it('takes a trimmed, normalised note and nothing else', () => {
    expect(OverstayReportInputSchema.parse({ note: '  A grey Fiat.\n' }).note).toBe('A grey Fiat.');
    expect(OverstayReportInputSchema.parse({ note: 'e\u0301' }).note).toBe('\u00e9');
    expect(OverstayReportInputSchema.safeParse({ note: 'x', status: 'resolved' }).success).toBe(
      false,
    );
  });

  it('holds a note to its length in characters, the longest allowed included', () => {
    expect(
      OverstayReportInputSchema.safeParse({ note: 'ö'.repeat(OVERSTAY_NOTE_MAX) }).success,
    ).toBe(true);
    const over = OverstayReportInputSchema.safeParse({ note: 'ö'.repeat(OVERSTAY_NOTE_MAX + 1) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe('textTooLong');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   \n '],
    ['a right-to-left override', 'IKB\u202E1234'],
    ['a zero-width space', 'in\u200Bvisible'],
    ['a Hangul filler', 'a\u3164b'],
    ['a line separator', 'a\u2028b'],
    ['a control character', 'bell\u0007'],
    ['a lone surrogate', 'a\ud800b'],
    ['a number', 42],
    ['nothing', undefined],
  ])('refuses a note that is %s', (_label, note) => {
    expect(OverstayReportInputSchema.safeParse({ note }).success).toBe(false);
  });

  it('keeps new lines and tabs, which are how people write', () => {
    expect(OverstayReportInputSchema.parse({ note: 'one\n\ttwo' }).note).toBe('one\n\ttwo');
  });

  it('allows two weeks after a stay, as the owners’ list and the API both read it', () => {
    expect(OVERSTAY_REPORT_DAYS).toBe(14);
  });
});

describe('the codes the report route answers with', () => {
  it('are the three an owner can meet beyond the usual ones', () => {
    expect(OVERSTAY_ERROR_CODES).toEqual([
      'BOOKING_NOT_ENDED',
      'OVERSTAY_TOO_LATE',
      'OVERSTAY_REPORTED',
    ]);
  });
});

describe('what owners read of a report', () => {
  it('is when it was made and whether it is closed, and drops anything else', () => {
    const parsed = OwnerOverstaySchema.parse({
      reportedAt: '2026-11-16T10:30:00.000Z',
      status: 'resolved',
      resolution: 'Ticket 7001',
    });
    expect(parsed).toEqual({ reportedAt: '2026-11-16T10:30:00.000Z', status: 'resolved' });
    expect(OwnerOverstaySchema.safeParse({ reportedAt: 'yesterday', status: 'open' }).success).toBe(
      false,
    );
    expect(
      OwnerOverstaySchema.safeParse({ reportedAt: '2026-11-16T10:30:00.000Z', status: 'x' })
        .success,
    ).toBe(false);
  });

  it('names the two states the table allows', () => {
    expect(OVERSTAY_STATUSES).toEqual(['open', 'resolved']);
  });
});

describe('staff’s queue', () => {
  it('asks for the open reports unless told otherwise', () => {
    expect(AdminOverstaysQuerySchema.parse({})).toEqual({ status: 'open' });
    expect(AdminOverstaysQuerySchema.parse({ status: 'resolved', after: PLACE })).toEqual({
      status: 'resolved',
      after: PLACE,
    });
  });

  it.each([
    { status: 'all' },
    { status: '' },
    { status: ['open'] },
    { after: 'nonsense' },
    { after: '1_x' },
    { after: `99999999999999999_${ID}` },
  ])('refuses the query %j', (query) => {
    expect(AdminOverstaysQuerySchema.safeParse(query).success).toBe(false);
  });

  const row = {
    id: ID,
    status: 'open',
    bookingId: ID,
    reference: 'K7M4-Q2ZD',
    listingName: null,
    contentLocale: 'el',
    endedAt: '2026-11-16T10:00:00.000Z',
    reportedAt: '2026-11-16T13:00:00.000Z',
  };

  it('holds a page to its size, and drops a driver or a note that slipped in', () => {
    const page = AdminOverstaysSchema.parse({
      reports: [{ ...row, vehiclePlate: 'IKB1234', note: 'x' }],
      next: null,
    });
    expect(page.reports[0]).toEqual(row);
    expect(
      AdminOverstaysSchema.safeParse({
        reports: Array.from({ length: ADMIN_PAGE_SIZE + 1 }, () => row),
        next: null,
      }).success,
    ).toBe(false);
  });

  it('wants a real reference', () => {
    expect(
      AdminOverstaysSchema.safeParse({ reports: [{ ...row, reference: 'nope' }], next: null })
        .success,
    ).toBe(false);
  });
});

describe('a report as staff read it', () => {
  const report = {
    id: ID,
    status: 'resolved',
    reportedAt: '2026-11-16T13:00:00.000Z',
    reporter: { name: 'Eleni' },
    note: 'A grey Fiat.',
    booking: {
      id: ID,
      reference: 'K7M4-Q2ZD',
      listing: { id: ID, name: null, contentLocale: 'en' },
      spaceLabel: 'A1',
      startsAt: '2026-11-16T08:00:00.000Z',
      endsAt: '2026-11-16T10:00:00.000Z',
    },
    resolution: { at: '2026-11-17T09:00:00.000Z', by: { name: 'Sam' }, note: 'Ticket 7001' },
    canResolve: false,
    own: false,
  };

  it('has no driver on it, whatever the API sends', () => {
    const parsed = AdminOverstaySchema.parse({
      ...report,
      booking: { ...report.booking, vehiclePlate: 'IKB1234', driver: { email: 'a@b.gr' } },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/IKB1234|a@b\.gr/);
  });

  it('holds the closing note to the log’s length', () => {
    expect(
      AdminOverstaySchema.safeParse({
        ...report,
        resolution: { ...report.resolution, note: 'x'.repeat(101) },
      }).success,
    ).toBe(false);
    expect(AdminOverstaySchema.safeParse({ ...report, resolution: null }).success).toBe(true);
  });
});

describe('the audit log', () => {
  it('names the closing of a report', () => {
    expect(AUDIT_ACTIONS).toContain('overstay.resolved');
  });
});
