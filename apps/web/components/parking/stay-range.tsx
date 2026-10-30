import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { stayOptions } from '@/i18n/formats';

/**
 * A stay as "Mon 2 Nov, 09:00 – 11:00" in the page language and the app's time zone. Screen
 * readers skip the dash at default punctuation, so it is hidden and "to" is read instead.
 */
export function StayRange({ start, end }: { start: string; end: string }) {
  const locale = useLocale();
  const timeZone = useTimeZone();
  const t = useTranslations('Listing');
  const from = new Date(start);
  const until = new Date(end);
  // Stays can start up to a year ahead: name the year when it is not this one.
  const year = (date: Date) =>
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(date);
  const thisYear = year(new Date());
  const otherYear = year(from) !== thisYear || year(until) !== thisYear;
  const parts = new Intl.DateTimeFormat(locale, {
    ...stayOptions(locale),
    ...(otherYear ? { year: 'numeric' } : {}),
    timeZone,
  }).formatRangeToParts(from, until);
  // The separator is the shared literal right before the first part of the end.
  const firstEnd = parts.findIndex((part) => part.source === 'endRange');
  const separator = firstEnd > 0 && parts[firstEnd - 1]?.type === 'literal' ? firstEnd - 1 : -1;
  const text = (from: number, to?: number) =>
    parts
      .slice(from, to)
      .map((part) => part.value)
      .join('');

  if (separator < 0) return <>{text(0)}</>;
  return (
    <>
      {text(0, separator)}
      <span aria-hidden>{parts[separator]?.value}</span>
      <span className="sr-only"> {t('until')} </span>
      {text(separator + 1)}
    </>
  );
}
