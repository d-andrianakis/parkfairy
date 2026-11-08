import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ownerBookingsHref } from '@/lib/owner-href';

/** Where to go when closing time is refused over bookings (decision #27): the listing's bookings. */
export function BookingsLink({ id }: { id: string }) {
  const t = useTranslations('Owner.bookings');
  return (
    <p>
      <Link
        href={ownerBookingsHref(id)}
        className="underline underline-offset-4 hover:decoration-2"
      >
        {t('seeBookings')}
      </Link>
    </p>
  );
}
