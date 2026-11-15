import type { Namespace } from '@/components/client-messages';

/**
 * The catalog namespaces each <ClientMessages> subtree sends to the browser. Component tests
 * render with the same lists (test/render.tsx), so a namespace missing here fails a test
 * instead of showing raw keys.
 */
export const CLIENT_NAMESPACES = {
  /** Root layout: the header's language switcher and sign-out, and the error boundary. */
  root: ['LocaleSwitcher', 'Header', 'Error'],
  /** Staff sign-in and its second step. */
  auth: ['SignIn', 'TwoFactor', 'AuthErrors', 'Validation', 'Forms'],
  /** A listing's review: the decision buttons and the note to the owner. */
  review: ['AdminReview', 'AdminErrors', 'Validation', 'Forms'],
} as const satisfies Record<string, readonly Namespace[]>;
