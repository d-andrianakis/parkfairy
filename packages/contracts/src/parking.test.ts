import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AREAS, AREA_IDS } from './areas.js';
import {
  currentSlotStart,
  MoneySchema,
  ParkingListingQuerySchema,
  ParkingSearchQuerySchema,
} from './parking.js';
import { isValidationMessage } from './validation.js';

const NOW = new Date('2026-10-29T08:12:00Z'); // 10:12 in Athens

function issues(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('ParkingSearchQuerySchema', () => {
  const window = { start: '2026-10-29T09:00:00Z', end: '2026-10-29T11:30:00Z' };

  it('accepts an area and a half-hour aligned window', () => {
    expect(ParkingSearchQuerySchema.parse({ area: 'syntagma', ...window })).toMatchObject({
      area: 'syntagma',
    });
  });

  it('accepts a position from query-string numbers instead of an area', () => {
    const parsed = ParkingSearchQuerySchema.parse({
      latitude: '37.97',
      longitude: '23.73',
      ...window,
    });
    expect(parsed).toMatchObject({ latitude: 37.97, longitude: 23.73 });
  });

  it('needs an area or a full position', () => {
    expect(issues(ParkingSearchQuerySchema.safeParse({ latitude: '37.9', ...window }))).toEqual([
      'area:locationRequired',
    ]);
    expect(
      issues(ParkingSearchQuerySchema.safeParse({ area: 'atlantis', ...window })),
    ).toHaveLength(1);
  });

  it('only accepts times on the half hour', () => {
    expect(
      issues(
        ParkingSearchQuerySchema.safeParse({
          area: 'syntagma',
          start: '2026-10-29T09:15:00Z',
          end: '2026-10-29T11:00:01Z',
        }),
      ),
    ).toEqual(['start:timeNotOnStep', 'end:timeNotOnStep']);
  });

  it('allows the current half-hour slot but nothing earlier', () => {
    const fromSlot = { area: 'syntagma', end: '2026-10-29T10:00:00Z' };
    expect(currentSlotStart()).toBe(Date.parse('2026-10-29T08:00:00Z'));
    expect(
      ParkingSearchQuerySchema.safeParse({ ...fromSlot, start: '2026-10-29T08:00:00Z' }).success,
    ).toBe(true);
    expect(
      issues(ParkingSearchQuerySchema.safeParse({ ...fromSlot, start: '2026-10-29T07:30:00Z' })),
    ).toEqual(['start:startInPast']);
  });

  it('needs the end after the start, at most 30 days later', () => {
    const at = (start: string, end: string) =>
      issues(ParkingSearchQuerySchema.safeParse({ area: 'syntagma', start, end }));
    expect(at('2026-10-29T09:00:00Z', '2026-10-29T09:00:00Z')).toEqual(['end:endBeforeStart']);
    expect(at('2026-10-29T09:00:00Z', '2026-11-28T09:00:00Z')).toEqual([]);
    expect(at('2026-10-29T09:00:00Z', '2026-11-28T09:30:00Z')).toEqual(['end:durationTooLong']);
  });

  it('reports malformed instants with a catalog key', () => {
    const result = ParkingSearchQuerySchema.safeParse({
      area: 'syntagma',
      start: 'tomorrow',
      end: '2026-10-29T11:00:00Z',
    });
    expect(issues(result)).toEqual(['start:dateInvalid']);
  });

  it('only ever reports translation keys', () => {
    const result = ParkingSearchQuerySchema.safeParse({
      area: 'atlantis',
      latitude: 'x',
      longitude: '999',
      start: 'a',
      end: 'b',
    });
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(isValidationMessage(message), message).toBe(true);
  });
});

describe('booking horizon and DST', () => {
  const at = (start: string, end: string) =>
    issues(ParkingSearchQuerySchema.safeParse({ area: 'syntagma', start, end }));

  it('refuses starts more than a year ahead, and far-future dates in general', () => {
    expect(at('2027-10-29T08:00:00Z', '2027-10-29T10:00:00Z')).toEqual([]); // 365 days
    expect(at('2027-10-30T08:00:00Z', '2027-10-30T10:00:00Z')).toEqual(['start:startTooFar']);
    expect(at('9999-12-31T22:00:00Z', '9999-12-31T23:30:00Z')).toEqual(['start:startTooFar']);
  });

  it('refuses an end in the far future even when the start is fine', () => {
    expect(at('2026-10-29T09:00:00Z', '9999-12-31T23:30:00Z')).toEqual(['end:durationTooLong']);
  });

  it('measures the 30 days on the Athens wall clock (autumn change adds a real hour)', () => {
    // 10 Oct 2027 09:00 → 9 Nov 2027 09:00 Athens: 30 wall-clock days, 30 days + 1 h real.
    vi.setSystemTime(new Date('2027-10-01T00:00:00Z'));
    expect(at('2027-10-10T06:00:00Z', '2027-11-09T07:00:00Z')).toEqual([]);
    expect(at('2027-10-10T06:00:00Z', '2027-11-09T07:30:00Z')).toEqual(['end:durationTooLong']);
  });
});

describe('MoneySchema', () => {
  it('only accepts whole minor units (no floats for money)', () => {
    expect(MoneySchema.safeParse({ amountMinor: 875, currency: 'EUR' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amountMinor: 8.75, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountMinor: -1, currency: 'EUR' }).success).toBe(false);
  });
});

describe('ParkingListingQuerySchema', () => {
  it('takes no window or a complete, valid one', () => {
    expect(ParkingListingQuerySchema.safeParse({}).success).toBe(true);
    expect(
      ParkingListingQuerySchema.safeParse({
        start: '2026-10-29T09:00:00Z',
        end: '2026-10-29T10:00:00Z',
      }).success,
    ).toBe(true);
    expect(issues(ParkingListingQuerySchema.safeParse({ start: '2026-10-29T09:00:00Z' }))).toEqual([
      'end:invalid',
    ]);
    expect(issues(ParkingListingQuerySchema.safeParse({ end: '2026-10-29T09:00:00Z' }))).toEqual([
      'end:invalid',
    ]);
  });
});

describe('areas', () => {
  it('have unique ids and coordinates in Greece', () => {
    expect(new Set(AREA_IDS).size).toBe(AREAS.length);
    for (const area of AREAS) {
      expect(area.latitude).toBeGreaterThan(34);
      expect(area.latitude).toBeLessThan(42);
      expect(area.longitude).toBeGreaterThan(19);
      expect(area.longitude).toBeLessThan(30);
    }
  });
});
