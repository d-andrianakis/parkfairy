import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col px-4 py-16">
      <ClientMessages namespaces={CLIENT_NAMESPACES.auth}>{children}</ClientMessages>
    </div>
  );
}
