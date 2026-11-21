'use client';

import { useEffect } from 'react';

import { sweepPasses } from '@/lib/offline-pass';

/**
 * Takes booking passes kept on this device (5A.3) off it when they are no longer this account's or
 * have run out: nobody is signed in, or someone else is, or their time has passed. It runs on every
 * page load that has a network, which is the only time anyone can say who is signed in; the cost
 * where nothing was ever kept is one failed cache lookup. Renders nothing.
 */
export function PassGuard({ signedIn, userId }: { signedIn: boolean; userId: string | null }) {
  useEffect(() => {
    void sweepPasses({ signedIn, userId });
  }, [signedIn, userId]);
  return null;
}
