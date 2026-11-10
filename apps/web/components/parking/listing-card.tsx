import type { Money, ParkingListingSummary, ParkingSearchResult } from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@parkfairy/ui/components/card';
import { MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FeatureBadges } from './feature-badges';
import { ListingPhotoImage } from './listing-photo';

export function useMoney() {
  const format = useFormatter();
  return ({ amountMinor, currency }: Money) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
}

interface ListingCardProps {
  listing: ParkingListingSummary | ParkingSearchResult;
  /** Query (e.g. the search window) carried to the listing page. */
  query?: Record<string, string>;
  headingLevel?: 'h2' | 'h3';
  /** The first result on a page: its photo is likely the largest thing in view. */
  priority?: boolean;
  /**
   * Its pin's number on the results map, shown while the map is (`data-map="shown"` on a
   * `group/results` around the list). Hidden from screen readers: each pin is named in full.
   */
  number?: number;
}

/** A listing in a grid or result list; the whole card links to the listing page. */
export function ListingCard({
  listing,
  query,
  headingLevel: Heading = 'h3',
  priority = false,
  number,
}: ListingCardProps) {
  const t = useTranslations('Listing');
  const tAreas = useTranslations('Areas');
  const format = useFormatter();
  const money = useMoney();
  const result = 'total' in listing ? listing : undefined;
  // Metres (to 10 m) under 1 km: "0 km" would say nothing. Round first, so 996 m is "1 km".
  const distance = (meters: number) => {
    const rounded = Math.max(10, Math.round(meters / 10) * 10);
    return rounded < 1000
      ? format.number(rounded, { style: 'unit', unit: 'meter' })
      : format.number(meters / 1000, {
          style: 'unit',
          unit: 'kilometer',
          maximumFractionDigits: 1,
        });
  };

  // Ring on keyboard focus only; the transparent outline is what forced-colors mode draws.
  return (
    <Card className="relative h-full gap-4 overflow-hidden pt-0 pb-5 transition-shadow hover:shadow-md has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:outline-hidden">
      {/* Decoration here: the name beside it is the link, and the listing page has the words. */}
      {listing.coverPhoto ? (
        <ListingPhotoImage
          photo={listing.coverPhoto}
          alt=""
          sizes="(min-width: 1024px) 20rem, (min-width: 640px) 50vw, 100vw"
          className="aspect-[3/2] w-full object-cover"
          priority={priority}
        />
      ) : null}
      <CardHeader className={listing.coverPhoto ? 'px-5' : 'px-5 pt-5'}>
        <CardTitle className="flex items-start gap-2 text-base">
          {number !== undefined ? (
            <span
              aria-hidden
              className="hidden size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground group-data-[map=shown]/results:grid"
            >
              {number}
            </span>
          ) : null}
          <Heading lang={listing.contentLocale}>
            <Link
              href={{ pathname: `/parking/${listing.slug}`, query }}
              className="outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {listing.name}
            </Link>
          </Heading>
        </CardTitle>
        <CardDescription lang={listing.contentLocale}>{listing.address}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            <MapPin aria-hidden />
            {tAreas(listing.area)}
          </Badge>
          {result ? (
            <span className="text-sm text-muted-foreground">
              {t('distance', { distance: distance(result.distanceMeters) })}
            </span>
          ) : null}
        </div>
        <FeatureBadges features={listing.features} />
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {result
              ? t('freeSpaces', { count: result.freeSpaces })
              : t('spaceCount', { count: listing.spaceCount })}
            <br />
            {t(listing.spacePricesVary ? 'perHourFrom' : 'perHour', {
              price: money(listing.hourlyRate),
            })}
          </p>
          {result ? (
            <p className="text-right">
              <span className="block text-xs text-muted-foreground">
                {t(listing.spacePricesVary ? 'totalLabelFrom' : 'totalLabel')}
              </span>
              <span className="text-lg font-semibold">{money(result.total)}</span>
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
