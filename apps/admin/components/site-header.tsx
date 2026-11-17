import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { LocaleSwitcher } from './locale-switcher';
import { SignOutButton } from './sign-out-button';
import { StaffNav } from './staff-nav';

/**
 * Server-rendered with the session the layout already read. The staff links show only for staff
 * with a second factor: to anyone else the screens are no use, and the API refuses them anyway.
 */
export function SiteHeader({ signedIn, staff }: { signedIn: boolean; staff: boolean }) {
  const t = useTranslations('Layout');
  return (
    <header className="border-b">
      {/* Items wrap on narrow screens so the page never scrolls sideways at 320px (WCAG 1.4.10). */}
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-end gap-x-2 gap-y-1 px-4 py-2">
        <Link
          href={staff ? '/listings' : '/sign-in'}
          className="mr-auto flex items-center gap-2 font-semibold"
        >
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          {t('brand')}
        </Link>
        {staff ? <StaffNav /> : null}
        <LocaleSwitcher />
        {signedIn ? <SignOutButton /> : null}
      </div>
    </header>
  );
}
