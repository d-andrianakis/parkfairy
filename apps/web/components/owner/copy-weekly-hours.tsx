'use client';

import { copyListingHours } from '@parkfairy/api-client';
import { useTranslations } from 'next-intl';
import { attempt } from '@/lib/owner-client';
import { CopyToListings, type OtherListing } from './copy-to-listings';

/**
 * Gives the owner's drafts and listings sent back this listing's weekly hours, replacing theirs
 * (decision #30). Saving the hours step moves on to the next one, so changes not yet saved are
 * saved here first, through `prepare`, rather than sending the owner away and back.
 */
export function CopyWeeklyHours({
  id,
  listings,
  unsaved,
  prepare,
}: {
  id: string;
  listings: OtherListing[];
  unsaved: boolean;
  prepare: () => Promise<boolean>;
}) {
  const t = useTranslations('Owner.hours');
  return (
    <CopyToListings
      name="copy-hours"
      listings={listings}
      unsaved={unsaved}
      prepare={prepare}
      copy={(to) => attempt(() => copyListingHours({ path: { id }, body: { to } }))}
      texts={{
        heading: t('copyHeading'),
        lead: t('copyLead'),
        legend: t('copyLegend'),
        all: t('copyAll'),
        button: t('copyButton'),
        copying: t('copying'),
        none: t('copyNone'),
        done: (count) => t('copyDone', { count }),
        kept: (outcome, name, listing) =>
          t.rich(outcome === 'booked' ? 'copyBooked' : 'copyLocked', { name, listing }),
        saving: t('copySaving'),
        notSaved: t('copyNotSaved'),
        savedDone: (count) => t('copySavedDone', { count }),
        savedRefused: (reason) => t('copySavedRefused', { reason }),
      }}
    />
  );
}
