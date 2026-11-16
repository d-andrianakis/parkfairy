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
  // To the primary owner, when a co-owner or a manager called a booking off (#69).
  'booking-cancelled-by-team',
  // To a booking's owners: support called it off, with the driver refunded in full (#82); and who
  // bears a lost dispute over it, as support decided (#83).
  'booking-cancelled-by-staff',
  'dispute-parkfairy-bears',
  'dispute-owners-bear',
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
  /** For the primary's email about a cancellation by their team: the role, never a name. */
  cancelledByRole?: 'co_owner' | 'manager' | undefined;
}

interface BookingEmailCopy {
  subject: (reference: string, listing: string) => string;
  heading: string;
  body: (listing: string) => string;
  action: string;
  note: string;
}

type Variant =
  | Exclude<BookingEmailKind, 'booking-cancelled-by-team'>
  | 'booking-cancelled-by-owner'
  | 'booking-cancelled-by-manager'
  | 'booking-cancelled-by-co-owner';

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
      'booking-cancelled-by-manager': {
        subject: (_reference, listing) => `Διαχειριστής ακύρωσε κράτηση για τον χώρο «${listing}»`,
        heading: 'Ένας διαχειριστής ακύρωσε μια κράτηση',
        body: (listing) =>
          `Ένας διαχειριστής του χώρου «${listing}» ακύρωσε μια κράτηση. Ο οδηγός ενημερώθηκε και του επιστρέφεται ολόκληρο το ποσό.`,
        action: 'Δείτε τους διαχειριστές',
        note: 'Στη σελίδα των ιδιοκτητών βλέπετε ποιοι διαχειρίζονται τον χώρο. Αν δεν το περιμένατε, μπορείτε να αφαιρέσετε τον διαχειριστή από εκεί.',
      },
      'booking-cancelled-by-co-owner': {
        subject: (_reference, listing) => `Συνιδιοκτήτης ακύρωσε κράτηση για τον χώρο «${listing}»`,
        heading: 'Ένας συνιδιοκτήτης ακύρωσε μια κράτηση',
        body: (listing) =>
          `Ένας συνιδιοκτήτης του χώρου «${listing}» ακύρωσε μια κράτηση. Ο οδηγός ενημερώθηκε και του επιστρέφεται ολόκληρο το ποσό.`,
        action: 'Δείτε τους ιδιοκτήτες',
        note: 'Στη σελίδα των ιδιοκτητών βλέπετε ποιοι έχουν πρόσβαση στον χώρο.',
      },
      'booking-cancelled-by-staff': {
        subject: (_reference, listing) => `Η υποστήριξη ακύρωσε κράτηση για τον χώρο «${listing}»`,
        heading: 'Η υποστήριξη ακύρωσε μια κράτηση',
        body: (listing) =>
          `Η υποστήριξη του Parkfairy ακύρωσε μια κράτηση για τον χώρο «${listing}». Ο οδηγός ενημερώθηκε και θα λάβει πλήρη επιστροφή χρημάτων.`,
        action: 'Δείτε τις κρατήσεις',
        note: 'Δεν θα λάβετε μερίδιο γι’ αυτή την κράτηση. Αν έχετε απορίες, επικοινωνήστε με την υποστήριξη του Parkfairy.',
      },
      'dispute-parkfairy-bears': {
        subject: (reference) => `Το μερίδιό σας από την κράτηση ${reference} θα σταλεί κανονικά`,
        heading: 'Το μερίδιό σας θα σταλεί κανονικά',
        body: (listing) =>
          `Η τράπεζα του οδηγού αμφισβήτησε την πληρωμή μιας κράτησης για τον χώρο «${listing}» και η αμφισβήτηση χάθηκε. Το κόστος το αναλαμβάνει το Parkfairy.`,
        action: 'Δείτε τις κρατήσεις',
        note: 'Το μερίδιό σας για αυτή την κράτηση θα σταλεί όπως πάντα, χωρίς καμία αλλαγή.',
      },
      'dispute-owners-bear': {
        subject: (reference) => `Το μερίδιό σας από την κράτηση ${reference} δεν θα σταλεί`,
        heading: 'Το μερίδιό σας από αυτή την κράτηση δεν θα σταλεί',
        body: (listing) =>
          `Η τράπεζα του οδηγού αμφισβήτησε την πληρωμή μιας κράτησης για τον χώρο «${listing}» και η αμφισβήτηση χάθηκε. Το κόστος το φέρνουν οι ιδιοκτήτες του χώρου: το μερίδιό σας για αυτή την κράτηση δεν θα σταλεί.`,
        action: 'Δείτε τα έσοδά σας',
        note: 'Οι υπόλοιπες κρατήσεις σας δεν επηρεάζονται. Αν έχετε απορίες, επικοινωνήστε με την υποστήριξη του Parkfairy.',
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
      'booking-cancelled-by-manager': {
        subject: (_reference, listing) => `A manager cancelled a booking for “${listing}”`,
        heading: 'A manager cancelled a booking',
        body: (listing) =>
          `A manager of “${listing}” cancelled a booking. The driver has been told and is being refunded in full.`,
        action: 'See the managers',
        note: 'The owners’ page shows who manages the listing. If you weren’t expecting this, you can remove the manager from there.',
      },
      'booking-cancelled-by-co-owner': {
        subject: (_reference, listing) => `A co-owner cancelled a booking for “${listing}”`,
        heading: 'A co-owner cancelled a booking',
        body: (listing) =>
          `A co-owner of “${listing}” cancelled a booking. The driver has been told and is being refunded in full.`,
        action: 'See the owners',
        note: 'The owners’ page shows who has access to the listing.',
      },
      'booking-cancelled-by-staff': {
        subject: (_reference, listing) => `Support cancelled a booking for “${listing}”`,
        heading: 'Support cancelled a booking',
        body: (listing) =>
          `Parkfairy support cancelled a booking for “${listing}”. The driver has been told and is being refunded in full.`,
        action: 'See the bookings',
        note: 'You won’t receive a share of this booking. If you have questions, contact Parkfairy support.',
      },
      'dispute-parkfairy-bears': {
        subject: (reference) => `Your share of booking ${reference} will be sent as usual`,
        heading: 'Your share will be sent as usual',
        body: (listing) =>
          `The driver’s bank disputed the payment for a booking at “${listing}”, and the dispute was lost. Parkfairy bears the cost.`,
        action: 'See the bookings',
        note: 'Your share of this booking will be sent as always, with no change.',
      },
      'dispute-owners-bear': {
        subject: (reference) => `Your share of booking ${reference} will not be sent`,
        heading: 'Your share of this booking will not be sent',
        body: (listing) =>
          `The driver’s bank disputed the payment for a booking at “${listing}”, and the dispute was lost. The owners of the listing bear the cost: your share of this booking will not be sent.`,
        action: 'See your earnings',
        note: 'Your other bookings are not affected. If you have questions, contact Parkfairy support.',
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
    kind === 'booking-cancelled-by-team'
      ? booking.cancelledByRole === 'manager'
        ? 'booking-cancelled-by-manager'
        : 'booking-cancelled-by-co-owner'
      : kind === 'booking-cancelled' && booking.cancelledBy === 'owner'
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
  // About the team, not the booking: to where the team is listed (the primary's own page).
  const path = forDriver
    ? `/${locale}/bookings/${booking.id}`
    : kind === 'booking-cancelled-by-team'
      ? `/${locale}/owner/listings/${booking.listingId}/owners`
      : kind === 'dispute-owners-bear'
        ? `/${locale}/owner/earnings`
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
