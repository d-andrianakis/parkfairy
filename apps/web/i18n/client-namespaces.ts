import type { Namespace } from '@/components/client-messages';

/**
 * The catalog namespaces each <ClientMessages> subtree sends to the browser. Component tests
 * render with the same lists (test/render.tsx), so a namespace missing here fails a test
 * instead of showing raw keys to users.
 */
export const CLIENT_NAMESPACES = {
  /** Root layout: header (language switcher, theme menu) and the error boundary. */
  root: ['LocaleSwitcher', 'Theme', 'Error'],
  /** Sign-in, sign-up, two-factor, forgotten password and email confirmation forms. */
  auth: [
    'SignIn',
    'SignUp',
    'TwoFactor',
    'ForgotPassword',
    'ResetPassword',
    'VerifyEmail',
    'AuthErrors',
    'Validation',
    'Forms',
  ],
  /** Account page: API identity, sign-out, two-factor settings. */
  account: ['Account', 'TwoFactorSettings', 'AuthErrors', 'Validation', 'Forms'],
  /** The owner area: dashboard buttons and every onboarding step. */
  owner: ['Owner', 'Validation', 'Forms', 'Features', 'Areas'],
  /** The search form's "use my location" button and the address field's suggestions. */
  searchForm: ['SearchForm'],
  /** "Show the map" on the search results, and the map's own labels. */
  resultsMap: ['ResultsMap'],
  /** The listing page's space picker: its button and refusals, no zod and no Validation. */
  bookSpace: ['BookSpace', 'BookingErrors'],
  /** A booking's page: the plate, confirming, letting go and cancelling. */
  booking: ['Booking', 'BookingErrors', 'Validation', 'Forms'],
} as const satisfies Record<string, readonly Namespace[]>;
