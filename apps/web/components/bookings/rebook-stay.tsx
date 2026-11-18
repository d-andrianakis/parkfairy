import type { Booking } from '@parkfairy/contracts';
import { useTranslations } from 'next-intl';

import { ClientMessages } from '@/components/client-messages';
import { StayRange } from '@/components/parking/stay-range';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { listingStayHref } from '@/lib/booking-links';
import { canRebook, rebookStay } from '@/lib/rebook';

import { RebookButton } from './rebook-button';

/**
 * "Book again" under a stay that is over (5A.2): which weekday and times it would be, and the press
 * that holds the same space for them. Nothing for a booking that is not a confirmed stay already
 * over, or whose space the owner has since removed.
 */
export function RebookStay({
  booking,
  now,
  nameId,
}: {
  booking: Booking;
  now: Date;
  /** The id of the heading that names the listing, so the button is read with it. */
  nameId?: string;
}) {
  const t = useTranslations('Bookings');
  if (!canRebook(booking, now) || !booking.spaceId) return null;
  const stay = rebookStay(booking.start, booking.end, now, booking.listing.timeZone);
  if (!stay) return null;
  const when = `rebook-${booking.id}`;
  return (
    <div className="grid gap-2">
      <p id={when} className="text-sm text-muted-foreground">
        {t('rebookWhen')} <StayRange start={stay.start} end={stay.end} />
      </p>
      {/* Around the button alone: the text above is this server component's, with its own messages. */}
      <ClientMessages namespaces={CLIENT_NAMESPACES.rebook}>
        <RebookButton
          listing={booking.listing.slug}
          spaceId={booking.spaceId}
          vehicleId={booking.vehicleId}
          start={stay.start}
          end={stay.end}
          chooseHref={listingStayHref(booking.listing.slug, stay.start, stay.end)}
          describedBy={nameId ? `${when} ${nameId}` : when}
        />
      </ClientMessages>
    </div>
  );
}
