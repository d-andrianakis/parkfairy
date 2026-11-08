import type { Booking } from '@parkfairy/contracts';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { StayRange } from '@/components/parking/stay-range';

/**
 * What was booked: where, which space, when, for how much and on which terms. The listing's name
 * and address, and the space's, are the owner's words, read in the owner's language.
 */
export function BookingFacts({ booking }: { booking: Booking }) {
  const t = useTranslations('Booking');
  const tListing = useTranslations('Listing');
  const format = useFormatter();
  const { listing } = booking;
  const money = ({ amountMinor, currency }: Booking['total']) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const settled = booking.status === 'confirmed' || booking.status === 'cancelled';

  const facts: (readonly [string, ReactNode])[] = [
    [
      t('parking'),
      listing.name ? (
        <span key="name" lang={listing.contentLocale}>
          {listing.name}
        </span>
      ) : (
        t('unnamed')
      ),
    ],
    ...(listing.address
      ? [
          [
            t('address'),
            <span key="address" lang={listing.contentLocale}>
              {listing.address}
            </span>,
          ] as const,
        ]
      : []),
    [
      t('space'),
      <span key="space" lang={listing.contentLocale} className="font-mono">
        {booking.spaceLabel}
      </span>,
    ],
    [t('stay'), <StayRange key="stay" start={booking.start} end={booking.end} />],
    [t('total'), money(booking.total)],
    ...(settled
      ? [
          [
            t('reference'),
            <span key="reference" className="font-mono">
              {booking.reference}
            </span>,
          ] as const,
        ]
      : []),
    ...(booking.vehiclePlate
      ? [
          [
            t('plate'),
            <span key="plate" className="font-mono">
              {booking.vehiclePlate}
            </span>,
          ] as const,
        ]
      : []),
    [t('cancellation'), tListing(`cancellation.${booking.cancellationPolicy}`)],
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
      {facts.map(([term, value]) => (
        <div key={term} className="grid gap-0.5 sm:contents">
          <dt className="text-sm text-muted-foreground">{term}</dt>
          <dd className="wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
