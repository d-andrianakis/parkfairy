'use client';

import { client } from '@parkfairy/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// Same-origin: Next.js proxies /api/v1/* to the API, so the session cookie travels with requests.
client.setConfig({ baseUrl: '/api' });

function isClientError(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // 4xx responses (unauthenticated, forbidden, not found) will not succeed on retry.
            retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
