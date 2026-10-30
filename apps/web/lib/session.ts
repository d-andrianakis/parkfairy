import 'server-only';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { redirect } from '@/i18n/navigation';
import { getAuth } from './auth';

/**
 * Session for the current request, or null. For rendering decisions only; the API enforces
 * access. Cached per request, so the layout (header) and the page share one lookup.
 * Never refreshes: a server component cannot set the renewed cookie, so the database would
 * be extended and the cookie not. The layout renders <SessionRefresh> when one is due.
 */
export const getSession = cache(async () => {
  // Read request headers first: it marks the route dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
});

/** For the layout: if the lookup fails (database down), render signed out, not an error page. */
export async function getLayoutSession() {
  try {
    return await getSession();
  } catch (error) {
    console.error('Session lookup failed; rendering signed out', error);
    return null;
  }
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
