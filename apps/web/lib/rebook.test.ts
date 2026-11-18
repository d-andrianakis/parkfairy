import { describe, expect, it } from 'vitest';

import { canRebook, rebookStay } from './rebook';

// Athens is UTC+2 in winter and UTC+3 in summer: 10:00 there is 08:00Z, then 07:00Z.
describe('rebookStay (5A.2)', () => {
  it('is the next day with the same weekday, at the same wall-clock time, for as long', () => {
    // Monday 2 November 2026, 10:00 to 12:30 in Athens; it is Wednesday 4th.
    const stay = rebookStay(
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T10:30:00.000Z',
      new Date('2026-11-04T09:00:00.000Z'),
    );
    expect(stay).toEqual({ start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T10:30:00.000Z' });
  });

  it('starts tomorrow when tomorrow is that weekday, never today', () => {
    // It is Sunday 8 November in Athens; the stay was on a Monday.
    expect(
      rebookStay(
        '2026-11-02T08:00:00.000Z',
        '2026-11-02T10:00:00.000Z',
        new Date('2026-11-08T12:00:00.000Z'),
      )?.start,
    ).toBe('2026-11-09T08:00:00.000Z');
    // On a Monday itself, the next one is a week away.
    expect(
      rebookStay(
        '2026-11-02T08:00:00.000Z',
        '2026-11-02T10:00:00.000Z',
        new Date('2026-11-09T12:00:00.000Z'),
      )?.start,
    ).toBe('2026-11-16T08:00:00.000Z');
  });

  it('keeps the wall-clock time across a change of clocks, and the length in real time', () => {
    // Saturday 24 October 10:00 to 12:00 (UTC+3). Clocks went back on the 25th, so the next Saturday,
    // 31 October, is winter time: 10:00 is then 08:00Z, the stay still two hours.
    const stay = rebookStay(
      '2026-10-24T07:00:00.000Z',
      '2026-10-24T09:00:00.000Z',
      new Date('2026-10-26T12:00:00.000Z'),
    );
    expect(stay).toEqual({ start: '2026-10-31T08:00:00.000Z', end: '2026-10-31T10:00:00.000Z' });
  });

  it('reads the weekday on the Athens clock, not the UTC one', () => {
    // 22:30Z on Sunday 1 November is already 00:30 on Monday in Athens (UTC+2): a Monday stay.
    const stay = rebookStay(
      '2026-11-01T22:30:00.000Z',
      '2026-11-02T00:30:00.000Z',
      new Date('2026-11-04T09:00:00.000Z'),
    );
    expect(stay?.start).toBe('2026-11-08T22:30:00.000Z');
  });
});

describe('rebookStay across a change of clocks', () => {
  it('keeps the real length of a stay that straddles the change', () => {
    // Saturday 24 October 21:00 to Sunday 08:00 is 10 h (UTC+3). Next Saturday 31 October is winter
    // time and the night has no change in it: 21:00 to 08:00 is 11 h of clock, but the stay is 10 h.
    const stay = rebookStay(
      '2026-10-24T18:00:00.000Z',
      '2026-10-25T04:00:00.000Z',
      new Date('2026-10-26T12:00:00.000Z'),
    );
    expect(stay?.start).toBe('2026-10-31T19:00:00.000Z');
    expect(new Date(stay?.end ?? '').getTime() - new Date(stay?.start ?? '').getTime()).toBe(
      10 * 3_600_000,
    );
  });

  it('keeps the length of a stay of several days', () => {
    const stay = rebookStay(
      '2026-11-02T08:00:00.000Z',
      '2026-11-05T08:00:00.000Z',
      new Date('2026-11-04T09:00:00.000Z'),
    );
    expect(stay).toEqual({ start: '2026-11-09T08:00:00.000Z', end: '2026-11-12T08:00:00.000Z' });
  });

  it('reads the zone it is given, not Athens', () => {
    // 10:00 in Athens is 08:00Z; read in UTC it is 08:00, and Monday there too: the same day.
    const stay = rebookStay(
      '2026-11-02T08:00:00.000Z',
      '2026-11-02T10:00:00.000Z',
      new Date('2026-11-04T09:00:00.000Z'),
      'UTC',
    );
    expect(stay).toEqual({ start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T10:00:00.000Z' });
  });
});

describe('canRebook', () => {
  const NOW = new Date('2026-11-04T09:00:00.000Z');
  const stay = { status: 'confirmed', end: '2026-11-02T10:00:00.000Z', spaceId: 'a' } as const;

  it('is for a confirmed stay that is over, in a space that is still there', () => {
    expect(canRebook(stay, NOW)).toBe(true);
    expect(canRebook({ ...stay, end: '2026-11-04T09:00:00.000Z' }, NOW)).toBe(true);
  });

  it('is not for one still to come or under way, a space removed, or any other status', () => {
    expect(canRebook({ ...stay, end: '2026-11-04T09:00:00.001Z' }, NOW)).toBe(false);
    expect(canRebook({ ...stay, spaceId: null }, NOW)).toBe(false);
    for (const status of ['held', 'cancelled', 'expired', 'released'] as const) {
      expect(canRebook({ ...stay, status }, NOW)).toBe(false);
    }
  });
});
