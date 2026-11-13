import { renderEmail, sentenceWith } from './layout.js';
import { OWNER_EMAIL_COPY, type OwnerEmailLocale } from './owner-emails.js';
import type { OutgoingEmail } from './transport.js';

/** Two to the driver, two to the listing's owner (decision #36). */
export const BOOKING_EMAIL_KINDS = [
  'booking-confirmed',
  'booking-cancelled',
  // A payment that couldn't book the space (too late for it, or for a hold let go: #3).
  'booking-payment-refunded',
  'booking-received',
  'booking-cancelled-by-driver',
] as const;
export type BookingEmailKind = (typeof BOOKING_EMAIL_KINDS)[number];

/** What the outbox keeps about a booking: no names of people, no plate. */
export interface BookingEmailFacts {
  id: string;
  listingId: string;
  reference: string;
  address: string | null;
  /** The language the owner wrote the listing in, for `lang` on their words. */
  contentLocale?: string | undefined;
  spaceLabel: string;
  /** ISO instants, written out in the reader's language and the listing's zone. */
  start: string;
  end: string;
  timeZone: string;
  totalMinor: number;
  currency: string;
  refundMinor?: number | undefined;
  cancelledBy?: 'driver' | 'owner' | undefined;
}

interface BookingEmailCopy {
  subject: (reference: string, listing: string) => string;
  heading: string;
  body: (listing: string) => string;
  action: string;
  note: string;
}

type Variant = BookingEmailKind | 'booking-cancelled-by-owner';

interface BookingEmailCatalog {
  labels: {
    listing: string;
    address: string;
    space: string;
    when: string;
    reference: string;
    total: string;
    refund: string;
  };
  /** A booking whose listing has lost its name since: only on a listing sent back. */
  unnamed: string;
  /** For the owner's emails; the driver's keep the site's own. */
  ownerFooter: string;
  driverFooter: string;
  kinds: Record<Variant, BookingEmailCopy>;
}

/**
 * The worker sends these, so they live here like the owner emails. Formal "you" in Greek; listed
 * for the native-speaker pass in progress.md. Listing names are the owner's own text.
 */
export const BOOKING_EMAIL_COPY: Record<OwnerEmailLocale, BookingEmailCatalog> = {
  el: {
    labels: {
      listing: 'Χώρος στάθμευσης',
      address: 'Διεύθυνση',
      space: 'Θέση',
      when: 'Άφιξη και αναχώρηση',
      reference: 'Κωδικός κράτησης',
      total: 'Σύνολο',
      refund: 'Επιστροφή χρημάτων',
    },
    unnamed: 'Χώρος στάθμευσης χωρίς όνομα',
    ownerFooter: OWNER_EMAIL_COPY.el.footer,
    driverFooter:
      'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή κάνατε κράτηση χώρου στάθμευσης στον ιστότοπό μας.',
    kinds: {
      'booking-confirmed': {
        subject: (reference) => `Η κράτησή σας επιβεβαιώθηκε (${reference})`,
        heading: 'Η κράτησή σας επιβεβαιώθηκε',
        body: (listing) => `Η θέση σας στον χώρο «${listing}» είναι κρατημένη.`,
        action: 'Δείτε την κράτηση',
        note: 'Αν σας ζητηθεί, δείξτε τον κωδικό κράτησης. Μπορείτε να ακυρώσετε από τη σελίδα της κράτησης, με τους όρους ακύρωσης του χώρου.',
      },
      'booking-cancelled': {
        subject: (reference) => `Η κράτησή σας ακυρώθηκε (${reference})`,
        heading: 'Η κράτησή σας ακυρώθηκε',
        body: (listing) => `Ακυρώσατε την κράτησή σας στον χώρο «${listing}».`,
        action: 'Δείτε την κράτηση',
        note: 'Η θέση δεν είναι πλέον κρατημένη για εσάς. Τυχόν επιστροφή χρημάτων γίνεται στην κάρτα με την οποία πληρώσατε· μπορεί να χρειαστούν μερικές ημέρες για να φανεί στην κίνηση της κάρτας ή της τράπεζάς σας.',
      },
      'booking-cancelled-by-owner': {
        subject: (reference) => `Η κράτησή σας ακυρώθηκε (${reference})`,
        heading: 'Ο ιδιοκτήτης ακύρωσε την κράτησή σας',
        body: (listing) =>
          `Ο ιδιοκτήτης του χώρου «${listing}» αναγκάστηκε να ακυρώσει την κράτησή σας. Θα σας επιστραφεί ολόκληρο το ποσό.`,
        action: 'Δείτε την κράτηση',
        note: 'Λυπούμαστε για την αναστάτωση. Τα χρήματα επιστρέφονται στην κάρτα με την οποία πληρώσατε· μπορεί να χρειαστούν μερικές ημέρες για να φανούν στην κίνηση της κάρτας ή της τράπεζάς σας. Μπορείτε να αναζητήσετε άλλον χώρο στο Parkfairy.',
      },
      'booking-payment-refunded': {
        subject: (reference) => `Τα χρήματά σας επιστρέφονται (${reference})`,
        heading: 'Τα χρήματά σας επιστρέφονται',
        body: (listing) =>
          `Δεν ήταν δυνατό να γίνει η κράτηση στον χώρο «${listing}» με αυτή την πληρωμή, γι’ αυτό σας επιστρέφεται ολόκληρο το ποσό.`,
        action: 'Δείτε την κράτηση',
        note: 'Μπορεί να χρειαστούν μερικές ημέρες για να φανεί στην κίνηση της κάρτας ή της τράπεζάς σας.',
      },
      'booking-received': {
        subject: (_reference, listing) => `Νέα κράτηση για τον χώρο «${listing}»`,
        heading: 'Έχετε νέα κράτηση',
        body: (listing) => `Ένας οδηγός έκλεισε θέση στον χώρο «${listing}».`,
        action: 'Δείτε τις κρατήσεις',
        note: 'Το όνομα του οδηγού και ο αριθμός κυκλοφορίας του αυτοκινήτου είναι στη σελίδα των κρατήσεων.',
      },
      'booking-cancelled-by-driver': {
        subject: (_reference, listing) => `Ακυρώθηκε κράτηση για τον χώρο «${listing}»`,
        heading: 'Ακυρώθηκε μια κράτηση',
        body: (listing) =>
          `Ένας οδηγός ακύρωσε μια κράτηση στον χώρο «${listing}». Η θέση είναι ξανά ελεύθερη για εκείνες τις ώρες.`,
        action: 'Δείτε τις κρατήσεις',
        note: 'Δεν χρειάζεται να κάνετε κάτι.',
      },
    },
  },
  en: {
    labels: {
      listing: 'Parking',
      address: 'Address',
      space: 'Space',
      when: 'Arrival and departure',
      reference: 'Booking reference',
      total: 'Total',
      refund: 'Refund',
    },
    unnamed: 'Unnamed parking',
    ownerFooter: OWNER_EMAIL_COPY.en.footer,
    driverFooter: 'Parkfairy. You’re receiving this because you booked parking with us.',
    kinds: {
      'booking-confirmed': {
        subject: (reference) => `Your parking is booked (${reference})`,
        heading: 'Your parking is booked',
        body: (listing) => `Your space at “${listing}” is booked.`,
        action: 'See your booking',
        note: 'Show the booking reference if you’re asked. You can cancel from the booking’s page, under the listing’s cancellation terms.',
      },
      'booking-cancelled': {
        subject: (reference) => `Your booking is cancelled (${reference})`,
        heading: 'Your booking is cancelled',
        body: (listing) => `You cancelled your booking at “${listing}”.`,
        action: 'See your booking',
        note: 'The space is no longer held for you. Any refund goes back to the card you paid with and can take a few days to show on your card or bank statement.',
      },
      'booking-cancelled-by-owner': {
        subject: (reference) => `Your booking is cancelled (${reference})`,
        heading: 'The owner cancelled your booking',
        body: (listing) =>
          `The owner of “${listing}” had to cancel your booking. You’ll get the full amount back.`,
        action: 'See your booking',
        note: 'We’re sorry for the trouble. The money goes back to the card you paid with and can take a few days to show on your card or bank statement. You can look for another space on Parkfairy.',
      },
      'booking-payment-refunded': {
        subject: (reference) => `Your payment is being refunded (${reference})`,
        heading: 'Your payment is being refunded',
        body: (listing) =>
          `We couldn’t book your space at “${listing}” with this payment, so all of it is going back to you.`,
        action: 'See your booking',
        note: 'It can take a few days to show on your card or bank statement.',
      },
      'booking-received': {
        subject: (_reference, listing) => `New booking for “${listing}”`,
        heading: 'You have a new booking',
        body: (listing) => `A driver has booked a space at “${listing}”.`,
        action: 'See the bookings',
        note: 'The driver’s name and number plate are on the bookings page.',
      },
      'booking-cancelled-by-driver': {
        subject: (_reference, listing) => `A booking for “${listing}” was cancelled`,
        heading: 'A driver cancelled their booking',
        body: (listing) =>
          `The driver cancelled their booking at “${listing}”. The space is free again for those hours.`,
        action: 'See the bookings',
        note: 'You don’t need to do anything.',
      },
    },
  },
};

/** The site's own formats: 24-hour clock in Greek, Intl's default in English (formats.ts). */
function stayRange(locale: OwnerEmailLocale, { start, end, timeZone }: BookingEmailFacts) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
    ...(locale === 'el'
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { hour: 'numeric', minute: '2-digit' }),
  }).formatRange(new Date(start), new Date(end));
}

const moneyIn = (locale: OwnerEmailLocale, amountMinor: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100);

export interface BookingEmail {
  kind: BookingEmailKind;
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
  listingName?: string | undefined;
  booking: BookingEmailFacts;
}

const DRIVER_KINDS = new Set<BookingEmailKind>([
  'booking-confirmed',
  'booking-cancelled',
  'booking-payment-refunded',
]);

export function renderBookingEmail({
  kind,
  to,
  locale,
  webUrl,
  listingName,
  booking,
}: BookingEmail): OutgoingEmail {
  const catalog = BOOKING_EMAIL_COPY[locale];
  const variant: Variant =
    kind === 'booking-cancelled' && booking.cancelledBy === 'owner'
      ? 'booking-cancelled-by-owner'
      : kind;
  const copy = catalog.kinds[variant];
  const listing = listingName || catalog.unnamed;
  const forDriver = DRIVER_KINDS.has(kind);
  const { labels } = catalog;
  const details = [
    // The owner's words, read in the language they wrote them in.
    {
      label: labels.listing,
      value: listing,
      lang: listingName ? booking.contentLocale : undefined,
    },
    ...(booking.address
      ? [{ label: labels.address, value: booking.address, lang: booking.contentLocale }]
      : []),
    { label: labels.space, value: booking.spaceLabel, lang: booking.contentLocale },
    { label: labels.when, value: stayRange(locale, booking) },
    { label: labels.reference, value: booking.reference },
    { label: labels.total, value: moneyIn(locale, booking.totalMinor, booking.currency) },
    ...(forDriver && booking.refundMinor !== undefined
      ? [{ label: labels.refund, value: moneyIn(locale, booking.refundMinor, booking.currency) }]
      : []),
  ];
  const path = forDriver
    ? `/${locale}/bookings/${booking.id}`
    : `/${locale}/owner/listings/${booking.listingId}/bookings`;
  return renderEmail({
    to,
    locale,
    subject: copy.subject(booking.reference, listing),
    heading: copy.heading,
    // The name read in the language its owner wrote it in; "Unnamed parking" is the email's own.
    body: sentenceWith(copy.body, listing, listingName ? booking.contentLocale : undefined),
    details,
    action: copy.action,
    url: new URL(path, webUrl).toString(),
    note: copy.note,
    linkFallback: OWNER_EMAIL_COPY[locale].linkFallback,
    footer: forDriver ? catalog.driverFooter : catalog.ownerFooter,
  });
}
