import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ownerBookingsHref } from '@/lib/owner-href';

/**
 * Where to go when closing time is refused over bookings (decision #27): the listing's bookings.
 * `onFollow` runs as the owner goes, to keep what isn't saved yet.
 */
export function BookingsLink({ id, onFollow }: { id: string; onFollow?: () => void }) {
  const t = useTranslations('Owner.bookings');
  return (
    <p>
      <Link
        href={ownerBookingsHref(id)}
        onClick={onFollow}
        className="underline underline-offset-4 hover:decoration-2"
      >
        {t('seeBookings')}
      </Link>
    </p>
  );
}
