import type { ManagedListings as Managed } from '@parkfairy/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { useTranslations } from 'next-intl';
import { PlaceWords } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { CALENDAR_HREF, closuresHref, ownerBookingsHref } from '@/lib/owner-href';

const LINK = 'text-primary underline underline-offset-4 hover:decoration-2';

/**
 * The listings the account manages (#69): where a manager starts, as an owner starts at their
 * dashboard. A manager has no listing to edit and no money to see, so it is only ways in to the
 * calendar, the bookings and the closures.
 */
export function ManagedListings({ listings }: { listings: Managed['listings'] }) {
  const t = useTranslations('Owner.managed');
  if (listings.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('title')}</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('lead')}</p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4">
          {listings.map((listing) => (
            <li key={listing.id} className="grid gap-1">
              <h3
                id={`managed-${listing.id}`}
                className="font-medium wrap-anywhere"
                lang={listing.name ? listing.contentLocale : undefined}
              >
                {listing.name ? (
                  <PlaceWords text={listing.name} lang={listing.contentLocale} />
                ) : (
                  t('untitled')
                )}
              </h3>
              <ul
                aria-labelledby={`managed-${listing.id}`}
                className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
              >
                <li>
                  <Link
                    href={{ pathname: CALENDAR_HREF, query: { listing: listing.id } }}
                    className={LINK}
                  >
                    {t('calendar')}
                  </Link>
                </li>
                <li>
                  <Link href={ownerBookingsHref(listing.id)} className={LINK}>
                    {t('bookings')}
                  </Link>
                </li>
                <li>
                  <Link href={closuresHref(listing.id)} className={LINK}>
                    {t('closures')}
                  </Link>
                </li>
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
