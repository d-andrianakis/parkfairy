'use client';

import { Button } from '@parkfairy/ui/components/button';
import { cn } from '@parkfairy/ui/lib/utils';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';

const ITEMS = [
  { href: '/listings', key: 'listings' },
  { href: '/users', key: 'users' },
  { href: '/bookings', key: 'bookings' },
  { href: '/payments', key: 'payments' },
  { href: '/overstays', key: 'overstays' },
  { href: '/audit', key: 'audit' },
] as const;

/** The staff screens. The page you are on is marked, in words for a screen reader (1.4.1). */
export function StaffNav() {
  const t = useTranslations('Header');
  const pathname = usePathname();
  return (
    <nav aria-label={t('staffNav')}>
      <ul className="flex flex-wrap items-center gap-1">
        {ITEMS.map(({ href, key }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(current && 'font-semibold underline underline-offset-4')}
              >
                <Link href={href} aria-current={current ? 'page' : undefined}>
                  {t(key)}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
