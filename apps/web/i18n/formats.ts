import type { DateTimeFormatOptions } from 'next-intl';

/**
 * Time formats shared by every place that shows a time of day. Greek timetables, shop hours
 * and bookings use the 24-hour clock (09:30, not 9:30 π.μ.); English keeps Intl's default.
 */
export function timeOptions(locale: string): DateTimeFormatOptions {
  return locale === 'el'
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { hour: 'numeric', minute: '2-digit' };
}

/** "Mon 2 Nov, 09:00" style, for a stay's start and end (format.dateTimeRange). */
export function stayOptions(locale: string): DateTimeFormatOptions {
  return { weekday: 'short', day: 'numeric', month: 'short', ...timeOptions(locale) };
}

/** Closing at midnight: "24:00" in Greek (h24), "12:00 AM" in English. */
export function endOfDayOptions(locale: string): DateTimeFormatOptions {
  return locale === 'el' ? { ...timeOptions(locale), hourCycle: 'h24' } : timeOptions(locale);
}
