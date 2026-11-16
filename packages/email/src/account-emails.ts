import { renderEmail } from './layout.js';
import type { OwnerEmailLocale } from './owner-emails.js';
import type { OutgoingEmail } from './transport.js';

export const ACCOUNT_EMAIL_KINDS = [
  'two-factor-removed',
  // Staff suspended the account, and brought it back (#79, #81).
  'account-suspended',
  'account-reinstated',
] as const;
export type AccountEmailKind = (typeof ACCOUNT_EMAIL_KINDS)[number];

interface AccountCopy {
  subject: string;
  heading: string;
  body: string;
  action: string;
  note: string;
}

interface AccountCatalog {
  linkFallback: string;
  footer: string;
  kinds: Record<AccountEmailKind, AccountCopy>;
}

/**
 * Emails about an account's security that the worker sends (#13): the one that tells a person their
 * two-factor authentication was removed by support, and their password with it, so the button leads
 * to setting a new one. It is a warning as much as a receipt: if they didn't ask, someone talked
 * support round, so it says to get in touch. No name, no staff member and no note is in it: the note
 * is for the audit log. Formal "you" in Greek; listed for the native-speaker pass.
 */
export const ACCOUNT_EMAIL_COPY: Record<OwnerEmailLocale, AccountCatalog> = {
  el: {
    linkFallback: 'Αν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο στον περιηγητή σας:',
    footer: 'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή αφορά την ασφάλεια του λογαριασμού σας.',
    kinds: {
      'two-factor-removed': {
        subject: 'Ο έλεγχος ταυτότητας δύο παραγόντων του λογαριασμού σας στο Parkfairy αφαιρέθηκε',
        heading: 'Ο έλεγχος ταυτότητας δύο παραγόντων αφαιρέθηκε',
        body: 'Η υποστήριξη του Parkfairy αφαίρεσε τον έλεγχο ταυτότητας δύο παραγόντων (τον κωδικό από την εφαρμογή ελέγχου ταυτότητας) από τον λογαριασμό σας, αφού ελέγχθηκε η ταυτότητά σας. Για την ασφάλειά σας, ακυρώθηκε και ο κωδικός πρόσβασής σας και αποσυνδεθήκατε από όλες τις συσκευές.',
        action: 'Ορίστε νέο κωδικό πρόσβασης',
        note: 'Μετά τη σύνδεση, ενεργοποιήστε ξανά τον έλεγχο ταυτότητας δύο παραγόντων από τη σελίδα του λογαριασμού σας. Αν δεν ζητήσατε εσείς αυτή την αλλαγή, επικοινωνήστε αμέσως με την υποστήριξη του Parkfairy.',
      },
      'account-suspended': {
        subject: 'Ο λογαριασμός σας στο Parkfairy τέθηκε σε αναστολή',
        heading: 'Ο λογαριασμός σας τέθηκε σε αναστολή',
        body: 'Θέσαμε σε αναστολή τον λογαριασμό σας στο Parkfairy. Δεν μπορείτε να συνδεθείτε μέχρι να άρουμε την αναστολή. Αποσυνδεθήκατε από όλες τις συσκευές.',
        action: 'Μετάβαση στο Parkfairy',
        note: 'Αν πιστεύετε ότι πρόκειται για λάθος, επικοινωνήστε με την υποστήριξη του Parkfairy και θα το εξετάσουμε.',
      },
      'account-reinstated': {
        subject: 'Ο λογαριασμός σας στο Parkfairy είναι ξανά ενεργός',
        heading: 'Ο λογαριασμός σας είναι ξανά ενεργός',
        body: 'Άρθηκε η αναστολή του λογαριασμού σας στο Parkfairy. Μπορείτε να συνδεθείτε ξανά με τον κωδικό πρόσβασής σας.',
        action: 'Σύνδεση',
        note: 'Σας ευχαριστούμε για την υπομονή σας.',
      },
    },
  },
  en: {
    linkFallback: 'If the button doesn’t work, copy this link into your browser:',
    footer: 'Parkfairy. You’re receiving this because it concerns the security of your account.',
    kinds: {
      'two-factor-removed': {
        subject: 'Two-factor authentication was removed from your Parkfairy account',
        heading: 'Two-factor authentication was removed',
        body: 'Parkfairy support removed two-factor authentication (the code from the authenticator app) from your account, after checking who you are. For your safety your password was cancelled too, and you were signed out on every device.',
        action: 'Set a new password',
        note: 'After you sign in, turn two-factor authentication on again from your account page. If you didn’t ask for this change, contact Parkfairy support straight away.',
      },
      'account-suspended': {
        subject: 'Your Parkfairy account has been suspended',
        heading: 'Your account has been suspended',
        body: 'We’ve suspended your Parkfairy account. You can’t sign in until we lift it, and you were signed out on every device.',
        action: 'Go to Parkfairy',
        note: 'If you think this is a mistake, contact Parkfairy support and we’ll look into it.',
      },
      'account-reinstated': {
        subject: 'Your Parkfairy account is active again',
        heading: 'Your account is active again',
        body: 'The suspension of your Parkfairy account has been lifted. You can sign in again with your password.',
        action: 'Sign in',
        note: 'Thank you for your patience.',
      },
    },
  },
};

/**
 * Where each button goes. After a removal the reset is how the person gets back in (their password
 * no longer opens the account); a suspended account has nowhere to go but the site, and no support
 * address exists yet to point at; a reinstated one signs in.
 */
const PAGE: Record<AccountEmailKind, string> = {
  'two-factor-removed': '/forgot-password',
  'account-suspended': '',
  'account-reinstated': '/sign-in',
};

export interface AccountEmail {
  kind: AccountEmailKind;
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
}

export function renderAccountEmail({ kind, to, locale, webUrl }: AccountEmail): OutgoingEmail {
  const catalog = ACCOUNT_EMAIL_COPY[locale];
  const copy = catalog.kinds[kind];
  return renderEmail({
    to,
    locale,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    action: copy.action,
    url: new URL(`/${locale}${PAGE[kind]}`, webUrl).toString(),
    note: copy.note,
    linkFallback: catalog.linkFallback,
    footer: catalog.footer,
  });
}
