import type { OpeningPeriod } from '@parkfairy/contracts';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { endOfDayOptions, timeOptions } from '@/i18n/formats';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function minutes(wallTime: string): number {
  const [hours = 0, mins = 0] = wallTime.split(':').map(Number);
  return hours * 60 + mins;
}

/** A wall time (`HH:MM`) as this language writes the time of day. */
export function useWallTime() {
  const format = useFormatter();
  const locale = useLocale();
  return (time: string) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes(time) % 1440)), {
      ...timeOptions(locale),
      timeZone: 'UTC',
    });
}

/** Weekly hours, Monday first, in the listing's local time. */
export function OpeningHours({ periods }: { periods: OpeningPeriod[] }) {
  const t = useTranslations('Listing');
  const format = useFormatter();
  const locale = useLocale();
  // 5 January 2026 is a Monday; formatted in UTC so the weekday never shifts.
  const weekday = (day: number) =>
    format.dateTime(new Date(Date.UTC(2026, 0, 4 + day)), { weekday: 'long', timeZone: 'UTC' });
  const time = (minute: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minute % 1440)), {
      ...(minute === 1440 ? endOfDayOptions(locale) : timeOptions(locale)),
      timeZone: 'UTC',
    });

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{t('openingHoursHeading')}</caption>
      <tbody className="divide-y">
        {WEEKDAYS.map((day) => {
          const today = periods.filter((period) => period.weekday === day);
          const allDay =
            today.length === 1 && today[0]?.opens === '00:00' && today[0]?.closes === '24:00';
          return (
            <tr key={day}>
              <th scope="row" className="py-2 pr-4 text-left font-medium">
                {weekday(day)}
              </th>
              <td className="py-2 text-right text-muted-foreground">
                {allDay ? (
                  t('open24h')
                ) : today.length === 0 ? (
                  t('closed')
                ) : (
                  <ul>
                    {today.map((period) => (
                      <li key={period.opens}>
                        {time(minutes(period.opens))}
                        {/* Screen readers skip a bare en dash at default punctuation. */}
                        <span aria-hidden>–</span>
                        <span className="sr-only"> {t('until')} </span>
                        {time(minutes(period.closes))}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
