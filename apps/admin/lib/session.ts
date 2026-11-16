import 'server-only';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { getAuth } from './auth';

/**
 * Session for the current request, or null. For rendering decisions only; the API enforces
 * access. Cached per request. Never refreshes: a staff session ends a week after sign-in
 * whatever the activity, on purpose (nothing here renews the cookie).
 */
export const getSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: true },
  });
  // Suspended by staff (5.2c, #79): its sessions were ended, so this is the belt for one that
  // opened in the same instant. Signed out, as far as any page can tell.
  return session?.user.suspendedAt ? null : session;
});

/** For the layout: if the lookup fails (database down), render signed out, not an error page. */
export async function getLayoutSession() {
  try {
    return await getSession();
  } catch (error) {
    // Name and code only: database errors quote their parameters, here the session token.
    const { name, code } = error as { name?: string; code?: string };
    console.error('Session lookup failed; rendering signed out', { name, code });
    return null;
  }
}

/** What an account may do here: the page is for platform staff with a second factor on. */
export type Standing = 'staff' | 'not-staff' | 'no-second-factor';

export function standingOf(user: {
  role?: string | null;
  twoFactorEnabled?: boolean | null;
}): Standing {
  if (user.role !== 'admin') return 'not-staff';
  return user.twoFactorEnabled ? 'staff' : 'no-second-factor';
}

/**
 * Pages for staff: signed out goes to sign-in (remembering where), anyone else gets the page's
 * standing back to explain. Only `staff` may see data, and the API says the same by itself.
 */
export async function requireSession(returnTo: string) {
  const session = await getSession();
  if (!session) {
    return redirect({
      href: { pathname: '/sign-in', query: { next: returnTo } },
      locale: await getLocale(),
    });
  }
  return { session, standing: standingOf(session.user) };
}
