import type { DateTimeFormatOptions } from 'next-intl';

/**
 * Greek times are on the 24-hour clock (09:30, not 9:30 π.μ.), as everywhere on the public site;
 * English keeps Intl's default. Put this on every date-and-time format.
 */
export function withClock(locale: string, options: DateTimeFormatOptions): DateTimeFormatOptions {
  return locale === 'el' ? { ...options, hourCycle: 'h23' } : options;
}
