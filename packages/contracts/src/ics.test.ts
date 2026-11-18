import { describe, expect, it } from 'vitest';

import { escapeIcsText, foldIcsLine, type IcsEvent, writeIcs } from './ics.js';

/** UTF-8 octets of a string: the bytes `encodeURIComponent` writes as %XX, one each, plus the rest. */
const utf8Length = (text: string): number =>
  encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, 'x').length;

const STAMP = new Date('2026-11-17T08:00:00.123Z');

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'booking-1@parkfairy',
    summary: 'Parkfairy · A1 (K7M4-Q2ZD)',
    stamp: STAMP,
    start: new Date('2026-11-18T07:30:00Z'),
    end: new Date('2026-11-18T10:00:00Z'),
    ...overrides,
  };
}

const write = (...events: IcsEvent[]) => writeIcs({ prodId: '-//Parkfairy//Bookings//EN', events });
/** Lines as a calendar app unfolds them. */
const unfold = (text: string) => text.replaceAll('\r\n ', '').split('\r\n');

describe('escapeIcsText', () => {
  it('escapes what could end a value or start another', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  });

  it('turns every kind of line break into a written \\n', () => {
    expect(escapeIcsText('a\r\nb\rc\nd\u2028e\u2029f')).toBe('a\\nb\\nc\\nd\\ne\\nf');
  });

  it('drops other control characters', () => {
    expect(escapeIcsText('a\u0000b\u0007c\u007Fd\u001Be')).toBe('abcde');
  });

  it('leaves Greek and symbols alone', () => {
    expect(escapeIcsText('Πάρκινγκ Ερμού · €5')).toBe('Πάρκινγκ Ερμού · €5');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets and unfolds back to the same line', () => {
    const line = `SUMMARY:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const pieces = folded.split('\r\n');
    expect(pieces.length).toBeGreaterThan(2);
    expect(utf8Length(pieces[0]!)).toBeLessThanOrEqual(75);
    for (const piece of pieces.slice(1)) {
      expect(piece.startsWith(' ')).toBe(true);
      expect(utf8Length(piece)).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe(line);
  });

  it('counts octets, not characters, and never splits one (Greek is two octets a letter)', () => {
    const line = `SUMMARY:${'Πάρκινγκ'.repeat(30)}`;
    const folded = foldIcsLine(line);
    for (const piece of folded.split('\r\n')) {
      expect(utf8Length(piece)).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe(line);
    expect(folded).not.toContain('�');
  });

  it('folds at exactly 75 octets, and a continuation holds 74 beside its leading space', () => {
    expect(foldIcsLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldIcsLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`);
    expect(foldIcsLine('x'.repeat(75 + 74 + 1))).toBe(
      `${'x'.repeat(75)}\r\n ${'x'.repeat(74)}\r\n x`,
    );
  });

  it('moves a 4-octet character that straddles the boundary to the next line', () => {
    expect(foldIcsLine(`${'x'.repeat(74)}🚗`)).toBe(`${'x'.repeat(74)}\r\n 🚗`);
  });

  it('keeps an astral character (4 octets) whole', () => {
    const line = `SUMMARY:${'🚗'.repeat(60)}`;
    const folded = foldIcsLine(line);
    expect(folded.replaceAll('\r\n ', '')).toBe(line);
    for (const piece of folded.split('\r\n')) {
      expect(utf8Length(piece)).toBeLessThanOrEqual(75);
    }
  });
});

describe('writeIcs', () => {
  it('writes a calendar with CRLF line ends and a closing CRLF', () => {
    const text = write(event());
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('writes a timed event in UTC, without milliseconds', () => {
    const lines = unfold(write(event()));
    expect(lines).toContain('DTSTAMP:20261117T080000Z');
    expect(lines).toContain('DTSTART:20261118T073000Z');
    expect(lines).toContain('DTEND:20261118T100000Z');
    expect(lines).toContain('UID:booking-1@parkfairy');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('SEQUENCE:0');
  });

  it('writes an all-day event with an exclusive end, across a month end', () => {
    const lines = unfold(
      write({
        uid: 'closure-2@parkfairy',
        summary: 'Closed',
        stamp: STAMP,
        startsOn: '2026-11-29',
        endsOn: '2026-11-30',
      }),
    );
    expect(lines).toContain('DTSTART;VALUE=DATE:20261129');
    expect(lines).toContain('DTEND;VALUE=DATE:20261201');
  });

  it('writes a one-day closure as one day', () => {
    const lines = unfold(
      write({
        uid: 'closure-1@parkfairy',
        summary: 'Closed',
        stamp: STAMP,
        startsOn: '2026-12-31',
        endsOn: '2026-12-31',
      }),
    );
    expect(lines).toContain('DTSTART;VALUE=DATE:20261231');
    expect(lines).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('cannot be made to add a property or event through user text', () => {
    const text = write(
      event({
        summary: 'x\r\nATTENDEE:mailto:evil@example.com',
        description: 'a\nEND:VEVENT\nBEGIN:VEVENT',
        location: 'b;c,d',
      }),
    );
    const lines = unfold(text);
    expect(lines.filter((line) => line.startsWith('ATTENDEE'))).toEqual([]);
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(lines).toContain('SUMMARY:x\\nATTENDEE:mailto:evil@example.com');
    expect(lines).toContain('LOCATION:b\\;c\\,d');
  });

  it('unfolds an escaped line break the fold cut in two, with no raw break left in the file', () => {
    // 72 letters, then a line break written as the two characters "\n" across the 75-octet line end.
    const summary = `${'a'.repeat(72)}\nb${'c'.repeat(100)}\\d`;
    const text = write(event({ summary }));
    expect(unfold(text)).toContain(`SUMMARY:${'a'.repeat(72)}\\nb${'c'.repeat(100)}\\\\d`);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('keeps a tab and an empty summary, and leaves out an empty description and location', () => {
    const lines = unfold(write(event({ summary: '', description: '', location: '' })));
    expect(lines).toContain('SUMMARY:');
    expect(lines.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
    expect(lines.some((line) => line.startsWith('LOCATION'))).toBe(false);
    expect(unfold(write(event({ summary: 'a\tb' })))).toContain('SUMMARY:a\tb');
  });

  it('keeps one event for a long uid full of separators', () => {
    const uid = `${'u,;\\'.repeat(60)}\r\nEND:VEVENT`;
    const lines = unfold(write(event({ uid })));
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(lines.find((line) => line.startsWith('UID:'))).toContain('\\,\\;\\\\');
  });

  it('writes the instants either side of a clock change in UTC, with no zone', () => {
    const lines = unfold(
      write(
        event({
          start: new Date('2026-03-29T00:30:00Z'),
          end: new Date('2026-10-25T00:30:00Z'),
        }),
      ),
    );
    expect(lines).toContain('DTSTART:20260329T003000Z');
    expect(lines).toContain('DTEND:20261025T003000Z');
    expect(lines.some((line) => line.includes('TZID') || line.includes('VTIMEZONE'))).toBe(false);
  });

  it('writes a leap-day instant, and events in the order given, the same each time', () => {
    const first = event({
      uid: 'first',
      start: new Date('2028-02-29T23:30:00Z'),
      end: new Date('2028-03-01T00:30:00Z'),
    });
    const second = event({ uid: 'second' });
    const text = write(first, second);
    expect(unfold(text)).toContain('DTSTART:20280229T233000Z');
    expect(text).toBe(write(first, second));
    expect(text.indexOf('UID:first')).toBeLessThan(text.indexOf('UID:second'));
  });

  it('writes a cancelled event with a raised sequence', () => {
    const lines = unfold(write(event({ status: 'CANCELLED', sequence: 3 })));
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain('SEQUENCE:3');
  });

  it('names the calendar, and folds a long Greek name without breaking it', () => {
    const name = 'Πάρκινγκ Ερμού '.repeat(10);
    const text = writeIcs({ prodId: '-//Parkfairy//Bookings//EN', name, events: [] });
    expect(unfold(text)).toContain(`X-WR-CALNAME:${name}`);
    for (const physical of text.split('\r\n')) {
      expect(utf8Length(physical)).toBeLessThanOrEqual(75);
    }
  });

  it('refuses an event that ends before it starts, or a day that is not a day', () => {
    expect(() =>
      write(
        event({ start: new Date('2026-11-18T10:00:00Z'), end: new Date('2026-11-18T10:00:00Z') }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      write({ uid: 'u', summary: 's', stamp: STAMP, startsOn: '2026-11-02', endsOn: '2026-11-01' }),
    ).toThrow(RangeError);
    expect(() =>
      write({ uid: 'u', summary: 's', stamp: STAMP, startsOn: '2026-1-2', endsOn: '2026-11-03' }),
    ).toThrow(RangeError);
  });

  it('refuses days that do not exist, instead of writing or rolling them over', () => {
    const closed = (startsOn: string, endsOn: string): IcsEvent => ({
      uid: 'u',
      summary: 's',
      stamp: STAMP,
      startsOn,
      endsOn,
    });
    for (const [from, to] of [
      ['2026-02-29', '2026-03-01'], // 2026 is not a leap year
      ['2026-02-27', '2026-02-31'],
      ['2026-13-01', '2026-13-02'],
      ['2026-00-10', '2026-01-10'],
      ['2026-04-31', '2026-05-01'],
    ] as const) {
      expect(() => write(closed(from, to)), `${from}..${to}`).toThrow(RangeError);
    }
  });

  it('accepts a leap day, and the day after a month and year end', () => {
    const lines = unfold(
      write({
        uid: 'leap',
        summary: 's',
        stamp: STAMP,
        startsOn: '2028-02-29',
        endsOn: '2028-02-29',
      }),
    );
    expect(lines).toContain('DTSTART;VALUE=DATE:20280229');
    expect(lines).toContain('DTEND;VALUE=DATE:20280301');
    const newYear = unfold(
      write({
        uid: 'ny',
        summary: 's',
        stamp: STAMP,
        startsOn: '2026-12-31',
        endsOn: '2026-12-31',
      }),
    );
    expect(newYear).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('refuses times a calendar cannot hold: past year 9999, or not a time at all', () => {
    const far = new Date('+010000-01-01T00:00:00Z');
    expect(() => write(event({ start: new Date('2026-01-01T00:00:00Z'), end: far }))).toThrow(
      RangeError,
    );
    expect(() => write(event({ stamp: far }))).toThrow(RangeError);
    expect(() => write(event({ stamp: new Date(Number.NaN) }))).toThrow(RangeError);
    // The last whole day there is can start an event, but has no next day to end on.
    expect(() =>
      write({ uid: 'u', summary: 's', stamp: STAMP, startsOn: '9999-12-31', endsOn: '9999-12-31' }),
    ).toThrow(RangeError);
  });

  it('writes an empty calendar', () => {
    const text = writeIcs({ prodId: '-//Parkfairy//Bookings//EN', events: [] });
    expect(text).not.toContain('BEGIN:VEVENT');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
