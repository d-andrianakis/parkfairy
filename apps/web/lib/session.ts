import 'server-only';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAuth } from './auth';

/** Session for the current request, or null. For rendering decisions only; the API enforces access. */
export async function getSession() {
  // Read request headers first: it marks the route dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

/** Redirects to the localized sign-in page (remembering `returnTo`) when signed out. */
export async function requireSession(returnTo: string) {
  const session = await getSession();
  if (!session) {
    return redirect({
      href: { pathname: '/sign-in', query: { next: returnTo } },
      locale: await getLocale(),
    });
  }
  return session;
}
