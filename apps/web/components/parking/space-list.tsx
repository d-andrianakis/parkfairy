import type { ParkingListingDetail } from '@parkfairy/contracts';
import { useFormatter, useTranslations } from 'next-intl';
import { FeatureBadges } from './feature-badges';

/**
 * The spaces the API sends, and how many more a big garage has. With a stay asked about it sends
 * the free ones only, so "more" counts the free spaces past those (`freeSpaces`), not booked ones.
 */
export function SpaceList({
  listing,
  labelledBy,
  freeSpaces,
}: {
  listing: Pick<
    ParkingListingDetail,
    'spaces' | 'spaceCount' | 'contentLocale' | 'spacePricesVary'
  >;
  labelledBy: string;
  freeSpaces?: number | undefined;
}) {
  const t = useTranslations('Listing');
  const format = useFormatter();
  const money = ({ amountMinor, currency }: { amountMinor: number; currency: string }) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const more = (freeSpaces ?? listing.spaceCount) - listing.spaces.length;
  return (
    <>
      {/* With a stay asked about, only the free ones come: maybe none. */}
      {listing.spaces.length > 0 ? (
        <ul aria-labelledby={labelledBy} className="mt-3 grid gap-2 sm:grid-cols-2">
          {listing.spaces.map((space) => (
            <li
              key={space.label}
              className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
            >
              {/* Owner content: Greek "Α1" looks like Latin "A1" but is read differently. */}
              <span lang={listing.contentLocale} className="font-mono font-medium">
                {space.label}
              </span>
              <FeatureBadges features={space.features} />
              {/* Only where prices differ; otherwise the price card has already said it. */}
              {listing.spacePricesVary ? (
                <span className="basis-full text-sm text-muted-foreground">
                  {t('spacePrice', { price: money(space.hourlyRate) })}
                  {space.total ? ` · ${t('spaceTotal', { price: money(space.total) })}` : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {more > 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(freeSpaces === undefined ? 'moreSpaces' : 'moreFreeSpaces', { count: more })}
        </p>
      ) : null}
    </>
  );
}
