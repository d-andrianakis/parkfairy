'use client';

import { copyListingHoursExceptions } from '@parkfairy/api-client';
import { HOURS_EXCEPTIONS_MAX } from '@parkfairy/contracts/validation';
import { useTranslations } from 'next-intl';
import { attempt } from '@/lib/owner-client';
import { CopyToListings, type OtherListing } from './copy-to-listings';

export type { OtherListing };

/** What a listing that kept its own dates is told, by why it kept them. */
const KEPT_MESSAGE = { clash: 'copyClash', full: 'copyFull', booked: 'copyBooked' } as const;
type Kept = keyof typeof KEPT_MESSAGE;
const isKept = (outcome: string): outcome is Kept => outcome in KEPT_MESSAGE;

/**
 * Adds a listing's saved closures and special hours to the owner's other listings, any or all of
 * them (decision #29). Unsaved changes have to be saved first: the page's own Save keeps the owner
 * on it, so asking costs one press.
 */
export function CopyHoursExceptions({
  id,
  listings,
  unsaved,
}: {
  id: string;
  listings: OtherListing[];
  unsaved: boolean;
}) {
  const t = useTranslations('Owner.closures');
  return (
    <CopyToListings
      name="copy-closures"
      listings={listings}
      unsaved={unsaved}
      copy={(to) => attempt(() => copyListingHoursExceptions({ path: { id }, body: { to } }))}
      texts={{
        heading: t('copyHeading'),
        lead: t('copyLead'),
        legend: t('copyLegend'),
        all: t('copyAll'),
        button: t('copyButton'),
        copying: t('copying'),
        none: t('copyNone'),
        unsaved: t('copyUnsaved'),
        done: (count) => t('copyDone', { count }),
        kept: (outcome, name, listing) =>
          t.rich(KEPT_MESSAGE[isKept(outcome) ? outcome : 'full'], {
            name,
            max: HOURS_EXCEPTIONS_MAX,
            listing,
          }),
      }}
    />
  );
}
