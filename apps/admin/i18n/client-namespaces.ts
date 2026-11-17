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
  /** The account lookup: one whole address, sent in a body. */
  lookup: ['AdminLookup', 'AdminErrors', 'Validation', 'Forms'],
  /** An account's page: removing its second factor, with the note of the identity check. */
  account: ['AdminUser', 'AdminAccount', 'AdminErrors', 'Validation', 'Forms'],
  /** The booking lookup: one reference, sent in a body. */
  bookingLookup: ['AdminBookingLookup', 'AdminErrors', 'Validation', 'Forms'],
  /** A booking's page: calling it off, its refund, a lost dispute. */
  booking: ['AdminBooking', 'AdminErrors', 'Validation', 'Forms'],
  /** An overstay report's page: closing it with a note. */
  overstay: ['AdminOverstay', 'AdminErrors', 'Validation', 'Forms'],
  /** A live or suspended listing: taking it down, bringing it back. */
  moderation: ['AdminModeration', 'AdminErrors', 'Validation', 'Forms'],
} as const satisfies Record<string, readonly Namespace[]>;
