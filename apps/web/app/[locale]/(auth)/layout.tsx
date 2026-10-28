import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-sm flex-col px-4 py-16">{children}</div>;
}
