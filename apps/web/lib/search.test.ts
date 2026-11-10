import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultWindow,
  parseListingWindow,
  parseSearch,
  TIME_OPTIONS,
  windowQuery,
} from './search';

const NOW = Date.parse('2026-10-29T08:12:00Z'); // Thursday 10:12 in Athens

// The contract's "not in the past" rule reads the clock too.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('TIME_OPTIONS', () => {
  it('offers every half hour of the day', () => {
    expect(TIME_OPTIONS).toHaveLength(48);
    expect(TIME_OPTIONS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00']);
    expect(TIME_OPTIONS.at(-1)).toBe('23:30');
  });
});

describe('defaultWindow', () => {
  it('starts at the next half hour, Athens time, for two hours', () => {
    expect(defaultWindow(NOW)).toEqual({
      startDate: '2026-10-29',
      startTime: '10:30',
      endDate: '2026-10-29',
      endTime: '12:30',
    });
  });

  it('crosses midnight on the Athens calendar', () => {
    expect(defaultWindow(Date.parse('2026-10-29T21:40:00Z'))).toEqual({
      startDate: '2026-10-30',
      startTime: '00:00',
      endDate: '2026-10-30',
      endTime: '02:00',
    });
  });
});

describe('parseSearch', () => {
  const window = {
    startDate: '2026-10-30',
    startTime: '09:00',
    endDate: '2026-10-30',
    endTime: '17:30',
  };

  it('shows the form without errors on a bare visit', () => {
    const parsed = parseSearch({}, NOW);
    expect(parsed).toMatchObject({ submitted: false, errors: {} });
    expect(parsed.query).toBeUndefined();
    expect(parsed.values.startTime).toBe('10:30');
  });

  it('turns Athens wall-clock fields into a UTC query', () => {
    expect(parseSearch({ area: 'syntagma', ...window }, NOW).query).toEqual({
      area: 'syntagma',
      start: '2026-10-30T07:00:00.000Z',
      end: '2026-10-30T15:30:00.000Z',
    });
  });

  it('uses the default window when only an area is given (area links on the home page)', () => {
    expect(parseSearch({ area: 'piraeusPort' }, NOW).query).toMatchObject({
      start: '2026-10-29T08:30:00.000Z',
      end: '2026-10-29T10:30:00.000Z',
    });
  });

  it('searches near a shared position, unless an area was picked', () => {
    const near = parseSearch({ latitude: '37.97', longitude: '23.73', ...window }, NOW);
    expect(near.query).toMatchObject({ latitude: 37.97, longitude: 23.73 });
    const picked = parseSearch(
      { area: 'koukaki', latitude: '37.97', longitude: '23.73', ...window },
      NOW,
    );
    expect(picked.query).toMatchObject({ area: 'koukaki' });
    expect(picked.query?.latitude).toBeUndefined();
  });

  it('reports each problem on its own field', () => {
    expect(parseSearch({ ...window, endTime: '08:00' }, NOW).errors).toEqual({
      area: 'locationRequired',
      end: 'endBeforeStart',
    });
    expect(
      parseSearch({ area: 'syntagma', ...window, startDate: '2026-10-28' }, NOW).errors,
    ).toEqual({ start: 'startInPast' });
    expect(parseSearch({ area: 'syntagma', ...window, startDate: 'soon' }, NOW).errors).toEqual({
      start: 'dateInvalid',
    });
    expect(parseSearch({ area: 'syntagma', ...window, endDate: '2026-12-30' }, NOW).errors).toEqual(
      { end: 'durationTooLong' },
    );
  });

  it('only accepts half-hour times', () => {
    expect(parseSearch({ area: 'syntagma', ...window, startTime: '09:15' }, NOW).errors).toEqual({
      start: 'timeNotOnStep',
    });
  });

  it('rejects unknown areas without echoing them as valid', () => {
    const parsed = parseSearch({ area: '<script>', ...window }, NOW);
    expect(parsed.errors).toEqual({ area: 'invalid' });
    expect(parsed.query).toBeUndefined();
  });

  it('takes the first value of repeated parameters', () => {
    expect(parseSearch({ area: ['ladadika', 'syntagma'], ...window }, NOW).query?.area).toBe(
      'ladadika',
    );
  });

  describe('a place (decision #40)', () => {
    it('searches at a picked place’s position and keeps its words for the title', () => {
      const parsed = parseSearch(
        { place: ' Ermou 10, Athens ', latitude: '37.9762', longitude: '23.7329', ...window },
        NOW,
      );
      expect(parsed.values.place).toBe('Ermou 10, Athens');
      expect(parsed.query).toMatchObject({ latitude: 37.9762, longitude: 23.7329 });
      expect(parsed.lookup).toBeUndefined();
    });

    it('asks for a look-up when the place has no position yet, and searches nothing meanwhile', () => {
      const parsed = parseSearch({ place: 'Σύνταγμα', latitude: '', ...window }, NOW);
      expect(parsed).toMatchObject({ submitted: true, errors: {}, lookup: 'Σύνταγμα' });
      expect(parsed.query).toBeUndefined();
    });

    it('spends no look-up on a search that fails anyway', () => {
      const parsed = parseSearch({ place: 'Σύνταγμα', ...window, endTime: '08:00' }, NOW);
      // The place's own problem is the look-up's to find, not "choose an area".
      expect(parsed.errors).toEqual({ end: 'endBeforeStart' });
      expect(parsed.lookup).toBeUndefined();
    });

    it('refuses a place too short to look up or too long to carry', () => {
      expect(parseSearch({ place: 'Σύ', ...window }, NOW)).toMatchObject({
        errors: { place: 'placeTooShort' },
        lookup: undefined,
      });
      expect(parseSearch({ place: 'x'.repeat(201), ...window }, NOW).errors).toEqual({
        place: 'textTooLong',
      });
    });

    it('looks a place up again when its position isn’t one, rather than saying nothing', () => {
      for (const position of [
        { latitude: 'abc', longitude: '23.7' },
        { latitude: '137.9', longitude: '23.7' },
        { latitude: '37.9', longitude: '' },
      ]) {
        const parsed = parseSearch({ place: 'Ermou 10', ...position, ...window }, NOW);
        expect(parsed).toMatchObject({ errors: {}, lookup: 'Ermou 10' });
      }
    });

    it('keeps the language a place is named in, only when it is one', () => {
      const placed = { place: 'Ερμού 10', latitude: '37.97', longitude: '23.73', ...window };
      expect(parseSearch({ ...placed, placeLocale: 'el' }, NOW).values.placeLocale).toBe('el');
      expect(parseSearch({ ...placed, placeLocale: 'xx' }, NOW).values.placeLocale).toBe('');
      expect(
        parseSearch({ ...window, area: 'koukaki', placeLocale: 'el' }, NOW).values.placeLocale,
      ).toBe('');
    });

    it('is left out where nothing could look it up, and the search asks where', () => {
      const parsed = parseSearch({ place: 'Σύνταγμα', ...window }, NOW, { lookups: false });
      expect(parsed.values.place).toBe('');
      expect(parsed).toMatchObject({ submitted: true, errors: { area: 'locationRequired' } });
      expect(parsed.lookup).toBeUndefined();
      // With a position it needs no look-up, and keeps its words for the title.
      const placed = parseSearch(
        { place: 'Σύνταγμα', latitude: '37.97', longitude: '23.73', ...window },
        NOW,
        { lookups: false },
      );
      expect(placed.values.place).toBe('Σύνταγμα');
      expect(placed.query).toMatchObject({ latitude: 37.97 });
    });

    it('gives way to a chosen area, as a shared position does', () => {
      const parsed = parseSearch(
        { area: 'koukaki', place: 'Ermou 10', latitude: '37.9', longitude: '23.7', ...window },
        NOW,
      );
      expect(parsed.values.place).toBe('');
      expect(parsed.query).toMatchObject({ area: 'koukaki' });
    });
  });
});

describe('parseListingWindow', () => {
  it('has no window unless one was given', () => {
    expect(parseListingWindow({}, NOW).window).toBeUndefined();
  });

  it('validates a given window', () => {
    const params = {
      startDate: '2026-10-30',
      startTime: '09:00',
      endDate: '2026-10-30',
      endTime: '10:00',
    };
    expect(parseListingWindow(params, NOW).window).toEqual({
      start: '2026-10-30T07:00:00.000Z',
      end: '2026-10-30T08:00:00.000Z',
    });
    expect(parseListingWindow({ ...params, endTime: '08:00' }, NOW).errors).toEqual({
      end: 'endBeforeStart',
    });
  });
});

describe('windowQuery', () => {
  it('carries exactly the window fields', () => {
    expect(windowQuery(defaultWindow(NOW))).toEqual({
      startDate: '2026-10-29',
      startTime: '10:30',
      endDate: '2026-10-29',
      endTime: '12:30',
    });
  });
});
