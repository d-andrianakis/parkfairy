import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { getLayoutSession } from '@/lib/session';

/**
 * Every owner page's client components get their messages here, once. A layout stays mounted while
 * the owner moves between the dashboard, the steps and the closures page, so the catalogue isn't
 * sent again with each one, as it was when each page wrapped its own. Signed out, `/owner` is a
 * landing of server components alone, which reads none of them. The lookup is the root layout's,
 * cached for the request.
 */
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!(await getLayoutSession())) return children;
  return <ClientMessages namespaces={CLIENT_NAMESPACES.owner}>{children}</ClientMessages>;
}
