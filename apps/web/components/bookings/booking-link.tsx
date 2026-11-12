import { useLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { getPathname, Link } from '@/i18n/navigation';
import { stripePublishableKey } from '@/lib/payments.server';

/**
 * A link to a booking's page that loads a real page where drivers pay: that page's CSP is the one
 * that lets Stripe's fields in (decision #49), and a client navigation keeps the policy of the page
 * it started from (memory.md). Without Stripe there is nothing to load, so it stays a client
 * navigation, prefetched and quicker.
 */
export function BookingLink({
  id,
  paying = true,
  ...props
}: Omit<ComponentProps<'a'>, 'href'> & {
  id: string;
  /** Whether the page may take a payment (a hold still running); a booking made needs none. */
  paying?: boolean;
}) {
  const locale = useLocale();
  const href = `/bookings/${id}`;
  if (!paying || stripePublishableKey() === null) return <Link href={href} {...props} />;
  return <a href={getPathname({ href, locale })} {...props} />;
}
