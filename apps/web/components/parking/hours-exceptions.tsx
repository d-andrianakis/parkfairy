import type { HoursException } from '@parkfairy/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { PeriodText, useWallTime } from './opening-hours';

/** A calendar day (`YYYY-MM-DD`) at noon UTC, so formatting it in UTC never moves the day. */
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * "Thursday 24 December" or a range of such days, each a `<time>`. The dash between two days is
 * hidden and "to" read instead, as in `StayRange`.
 */
function DayRange({ from, to, format }: { from: string; to: string; format: Intl.DateTimeFormat }) {
  const t = useTranslations('Listing');
  const parts = format.formatRangeToParts(noon(from), noon(to));
  const firstEnd = parts.findIndex((part) => part.source === 'endRange');
  const separator = firstEnd > 0 && parts[firstEnd - 1]?.type === 'literal' ? firstEnd - 1 : -1;
  const text = (start: number, end?: number) =>
    parts
      .slice(start, end)
      .map((part) => part.value)
      .join('');

  if (separator < 0) return <time dateTime={from}>{text(0)}</time>;
  return (
    <>
      <time dateTime={from}>{text(0, separator)}</time>
      <span aria-hidden>{parts[separator]?.value}</span>
      <span className="sr-only"> {t('until')} </span>
      <time dateTime={to}>{text(separator + 1)}</time>
    </>
  );
}

/**
 * Closures and special hours that haven't ended, soonest first, in the listing's local time.
 * `today` is the listing's calendar day, for leaving out this year's number. The table takes its
 * name from the heading `labelledBy` points at.
 */
export function HoursExceptions({
  exceptions,
  today,
  labelledBy,
}: {
  exceptions: HoursException[];
  today: string;
  labelledBy: string;
}) {
  const t = useTranslations('Listing');
  const locale = useLocale();
  const time = useWallTime();
  // Two at most, whatever the number of rows: with the year and without.
  const formats = new Map<boolean, Intl.DateTimeFormat>();
  const formatFor = (withYear: boolean) => {
    let format = formats.get(withYear);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        ...(withYear ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      });
      formats.set(withYear, format);
    }
    return format;
  };
  const thisYear = today.slice(0, 4);

  return (
    <table aria-labelledby={labelledBy} className="w-full text-sm">
      <tbody className="divide-y">
        {exceptions.map(({ startsOn, endsOn, hours, closedHours }) => (
          <tr key={startsOn}>
            <th scope="row" className="py-2 pr-4 text-left font-medium">
              <DayRange
                from={startsOn}
                to={endsOn}
                format={formatFor(
                  startsOn.slice(0, 4) !== thisYear || endsOn.slice(0, 4) !== thisYear,
                )}
              />
            </th>
            <td className="py-2 text-right text-muted-foreground">
              {hours ? (
                <PeriodText opens={hours.opens} closes={hours.closes} />
              ) : closedHours ? (
                t('closedBetween', { from: time(closedHours.from), to: time(closedHours.to) })
              ) : (
                t('closed')
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
