import type { ParkingListingDetail } from '@parkfairy/contracts';
import { useTranslations } from 'next-intl';
import { FeatureBadges } from './feature-badges';

/** The spaces the API sends, and how many more a big garage has. */
export function SpaceList({
  listing,
  labelledBy,
}: {
  listing: Pick<ParkingListingDetail, 'spaces' | 'spaceCount' | 'contentLocale'>;
  labelledBy: string;
}) {
  const t = useTranslations('Listing');
  const more = listing.spaceCount - listing.spaces.length;
  return (
    <>
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
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('moreSpaces', { count: more })}</p>
      ) : null}
    </>
  );
}
