import { useLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { getPathname, Link } from '@/i18n/navigation';
import { mapboxToken } from '@/lib/maps.server';

/**
 * A link into search that loads a real page where the results can have a map: the search page's
 * CSP is the one that lets the map load (decision #41), and a client navigation keeps the policy of
 * the page it started from (memory.md, as for the owner's location step). Without a token there is
 * no map, so it stays a client navigation, prefetched and quicker.
 */
export function SearchLink({
  query,
  ...props
}: Omit<ComponentProps<'a'>, 'href'> & { query?: Record<string, string> }) {
  const locale = useLocale();
  if (mapboxToken() === null) return <Link href={{ pathname: '/search', query }} {...props} />;
  return <a href={getPathname({ href: { pathname: '/search', query }, locale })} {...props} />;
}
