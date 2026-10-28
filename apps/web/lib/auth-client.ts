'use client';

import type { Auth } from '@parkfairy/auth';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// No baseURL: the auth handlers live on this same origin under /api/auth.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>(), twoFactorClient()],
});
