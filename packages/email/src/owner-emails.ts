import { renderEmail } from './layout.js';
import type { OutgoingEmail } from './transport.js';

export const OWNER_EMAIL_KINDS = [
  'listing-submitted',
  'listing-approved',
  'listing-changes-requested',
  'onboarding-reminder',
] as const;
export type OwnerEmailKind = (typeof OWNER_EMAIL_KINDS)[number];

export const OWNER_EMAIL_LOCALES = ['el', 'en'] as const;
export type OwnerEmailLocale = (typeof OWNER_EMAIL_LOCALES)[number];

interface OwnerEmailCopy {
  subject: string;
  heading: string;
  /** `listing` is the owner's own name for it; empty for the reminder, which names none. */
  body: (listing: string) => string;
  action: string;
  note: string;
}

interface OwnerEmailCatalog {
  linkFallback: string;
  footer: string;
  kinds: Record<OwnerEmailKind, OwnerEmailCopy>;
}

/**
 * These live here, not in the web app's catalogs, because the worker sends them. Same rules:
 * formal "you" in Greek, listed for the native-speaker pass in progress.md.
 */
export const OWNER_EMAIL_COPY: Record<OwnerEmailLocale, OwnerEmailCatalog> = {
  el: {
    linkFallback: 'Αν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο στον περιηγητή σας:',
    footer:
      'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή καταχωρίζετε χώρο στάθμευσης στον ιστότοπό μας.',
    kinds: {
      'listing-submitted': {
        subject: 'Λάβαμε την καταχώριση του χώρου σας',
        heading: 'Λάβαμε την καταχώριση του χώρου σας',
        body: (listing) =>
          `Η ομάδα μας παρέλαβε την καταχώριση του χώρου «${listing}». Θα ελέγξουμε τα στοιχεία και το έγγραφο για το δικαίωμα ενοικίασης και θα σας ενημερώσουμε με email.`,
        action: 'Δείτε την πρόοδό σας',
        note: 'Όσο γίνεται ο έλεγχος, δεν μπορείτε να αλλάξετε τον χώρο.',
      },
      'listing-approved': {
        subject: 'Ο χώρος στάθμευσής σας δημοσιεύτηκε',
        heading: 'Ο χώρος στάθμευσής σας δημοσιεύτηκε',
        body: (listing) =>
          `Ο χώρος «${listing}» πέρασε τον έλεγχο και οι οδηγοί μπορούν πλέον να τον βρουν στο Parkfairy.`,
        action: 'Δείτε τους χώρους σας',
        note: 'Σας ευχαριστούμε που επιλέξατε το Parkfairy.',
      },
      'listing-changes-requested': {
        subject: 'Ο χώρος στάθμευσής σας χρειάζεται μια αλλαγή',
        heading: 'Ο χώρος στάθμευσής σας χρειάζεται μια αλλαγή',
        body: (listing) =>
          `Ελέγξαμε τον χώρο «${listing}» και χρειάζεται μια αλλαγή για να δημοσιευτεί.`,
        action: 'Δείτε τι χρειάζεται',
        note: 'Όσα έχετε συμπληρώσει είναι αποθηκευμένα. Κάντε την αλλαγή και στείλτε τον ξανά.',
      },
      'onboarding-reminder': {
        subject: 'Ολοκληρώστε την καταχώριση του χώρου σας',
        heading: 'Ολοκληρώστε την καταχώριση του χώρου σας',
        body: () =>
          'Ξεκινήσατε να καταχωρίζετε τον χώρο στάθμευσής σας στο Parkfairy. Όσα συμπληρώσατε είναι αποθηκευμένα, οπότε μπορείτε να συνεχίσετε από εκεί που σταματήσατε.',
        action: 'Συνέχεια',
        note: 'Αυτή είναι η μοναδική υπενθύμιση που θα σας στείλουμε.',
      },
    },
  },
  en: {
    linkFallback: 'If the button doesn’t work, copy this link into your browser:',
    footer: 'Parkfairy. You’re receiving this because you list parking with us.',
    kinds: {
      'listing-submitted': {
        subject: 'We’ve received your listing',
        heading: 'We’ve received your listing',
        body: (listing) =>
          `“${listing}” is with our team now. We’ll check the details and your proof that you can rent it out, and let you know by email.`,
        action: 'See your progress',
        note: 'You can’t change it while we’re checking.',
      },
      'listing-approved': {
        subject: 'Your listing is live',
        heading: 'Your listing is live',
        body: (listing) =>
          `“${listing}” passed our checks, and drivers can now find it on Parkfairy.`,
        action: 'See your listings',
        note: 'Thank you for choosing Parkfairy.',
      },
      'listing-changes-requested': {
        subject: 'Your listing needs a change',
        heading: 'Your listing needs a change',
        body: (listing) => `We checked “${listing}”, and it needs a change before it can go live.`,
        action: 'See what’s needed',
        note: 'Everything you entered is saved. Make the change and send it again.',
      },
      'onboarding-reminder': {
        subject: 'Finish listing your parking',
        heading: 'Finish listing your parking',
        body: () =>
          'You started listing your parking on Parkfairy. Everything you entered is saved, so you can carry on from where you stopped.',
        action: 'Continue',
        note: 'This is the only reminder we’ll send.',
      },
    },
  },
};

export interface OwnerEmail {
  kind: OwnerEmailKind;
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
  listingName?: string | undefined;
}

export function renderOwnerEmail({
  kind,
  to,
  locale,
  webUrl,
  listingName = '',
}: OwnerEmail): OutgoingEmail {
  const catalog = OWNER_EMAIL_COPY[locale];
  const copy = catalog.kinds[kind];
  return renderEmail({
    to,
    locale,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body(listingName),
    action: copy.action,
    url: new URL(`/${locale}/owner`, webUrl).toString(),
    note: copy.note,
    linkFallback: catalog.linkFallback,
    footer: catalog.footer,
  });
}
