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
  /** The search form's "use my location" button. */
  searchForm: ['SearchForm'],
} as const satisfies Record<string, readonly Namespace[]>;
