/**
 * A small iCalendar (RFC 5545) writer, for the pass's "add to calendar" file and the owners' feeds
 * (Phase 5A). Hand-written rather than a dependency: it only writes, and what it writes is ours.
 *
 * What it guarantees, since the text in an event is user text (listing and space names):
 * - nothing typed can end a line or start a property: backslash, semicolon, comma and every kind of
 *   line break are escaped, and other control characters are dropped;
 * - lines are folded at 75 *bytes* (the RFC counts octets), never inside a character, which matters
 *   for Greek;
 * - times are written in UTC, or as whole days for closures.
 */

const CRLF = '\r\n';
/** Octets per line before folding, CRLF not counted (RFC 5545 §3.1). */
const FOLD_AT = 75;

/**
 * `YYYYMMDDTHHMMSSZ`. Only years 0000 to 9999 have four digits: a Date outside them (or an invalid
 * one) is refused rather than written as `+0100000101T…`, which no calendar reads.
 */
function utc(date: Date): string {
  const year = date.getUTCFullYear();
  if (!(year >= 0 && year <= 9999)) throw new RangeError('Not a time a calendar can hold.');
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** The day itself, if `YYYY-MM-DD` names a real one (2026-02-31 and 2026-13-01 do not). */
function realDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
  if (!real) throw new RangeError(`Not a calendar day: ${value}`);
  return value;
}

/** `2026-11-17` → `20261117`. Whole days are plain calendar dates, with no zone. */
function day(value: string): string {
  return realDay(value).replaceAll('-', '');
}

/** An RFC 5545 TEXT value: escaped so it cannot end the line or add a parameter. */
export function escapeIcsText(value: string): string {
  return (
    value
      // Control characters other than the line breaks (handled next) have no business in an event.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      // CRLF, CR, LF, and the Unicode line and paragraph separators all become a written "\n".
      .replace(/\r\n|\r|\n|\u2028|\u2029/g, '\\n')
  );
}

/** Octets a character takes in UTF-8 (this package has no `TextEncoder` type, and needs none). */
function octets(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** Folds one content line at 75 octets, continuing each piece after a CRLF and a space. */
export function foldIcsLine(line: string): string {
  let total = 0;
  for (const character of line) total += octets(character);
  if (total <= FOLD_AT) return line;
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  // The first line may hold 75 octets; each continuation 74, since it starts with a space.
  let limit = FOLD_AT;
  for (const character of line) {
    const width = octets(character);
    if (size + width > limit) {
      pieces.push(current);
      current = '';
      size = 0;
      limit = FOLD_AT - 1;
    }
    current += character;
    size += width;
  }
  pieces.push(current);
  return pieces.join(`${CRLF} `);
}

interface IcsEventBase {
  /** Stable for the same booking or closure, so a calendar updates it instead of adding another. */
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** When this version of the event was written; a calendar prefers the latest. */
  stamp: Date;
  status?: 'CONFIRMED' | 'CANCELLED';
  /** Raised each time the event changes, so a calendar takes the new version. */
  sequence?: number;
}

export interface IcsTimedEvent extends IcsEventBase {
  start: Date;
  end: Date;
}

/** A whole-day event: `endsOn` is the last day, inclusive, as owners think of closures. */
export interface IcsAllDayEvent extends IcsEventBase {
  startsOn: string;
  endsOn: string;
}

export type IcsEvent = IcsTimedEvent | IcsAllDayEvent;

export interface IcsCalendar {
  /** `-//Parkfairy//Bookings//EN`: who wrote it, for the calendar's own diagnostics. */
  prodId: string;
  /** The calendar's display name in apps that show one. */
  name?: string;
  events: readonly IcsEvent[];
}

/** The day after a `YYYY-MM-DD` day: all-day DTEND is exclusive. */
function nextDay(value: string): string {
  const date = new Date(`${realDay(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  // 9999-12-31 has no next day with four digits.
  if (date.getUTCFullYear() > 9999) throw new RangeError(`No day after: ${value}`);
  return date.toISOString().slice(0, 10);
}

function eventLines(event: IcsEvent): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${escapeIcsText(event.uid)}`, `DTSTAMP:${utc(event.stamp)}`];
  if ('start' in event) {
    if (!(event.start < event.end)) throw new RangeError('An event must end after it starts.');
    lines.push(`DTSTART:${utc(event.start)}`, `DTEND:${utc(event.end)}`);
  } else {
    if (event.endsOn < event.startsOn)
      throw new RangeError('An event must not end before it starts.');
    lines.push(
      `DTSTART;VALUE=DATE:${day(event.startsOn)}`,
      `DTEND;VALUE=DATE:${day(nextDay(event.endsOn))}`,
    );
  }
  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  lines.push(`STATUS:${event.status ?? 'CONFIRMED'}`, `SEQUENCE:${event.sequence ?? 0}`);
  lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  return lines;
}

/** The whole calendar as `text/calendar`, CRLF line ends and a closing CRLF, as the RFC asks. */
export function writeIcs({ prodId, name, events }: IcsCalendar): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${escapeIcsText(prodId)}`];
  lines.push('CALSCALE:GREGORIAN', 'METHOD:PUBLISH');
  if (name) lines.push(`X-WR-CALNAME:${escapeIcsText(name)}`);
  for (const event of events) lines.push(...eventLines(event));
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
