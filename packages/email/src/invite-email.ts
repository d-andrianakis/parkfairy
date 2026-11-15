import { LISTING_INVITE_DAYS } from '@parkfairy/contracts';
import { renderEmail } from './layout.js';
import type { OwnerEmailLocale } from './owner-emails.js';
import type { OutgoingEmail } from './transport.js';

/**
 * How long the link works, as the email says it: the invite's own lifetime. The copy's "days" is
 * plural: a test holds it above one.
 */
export const INVITE_EMAIL_DAYS = LISTING_INVITE_DAYS;

interface InviteCopy {
  subject: string;
  heading: string;
  body: string;
  action: string;
  note: string;
  linkFallback: string;
  footer: string;
}

/**
 * The invite to own a listing with its owners (#56). The worker sends it, so the copy lives here,
 * as the owners' does: formal "you" in Greek, no gendered words for anyone, listed for the
 * native-speaker pass. Nothing an owner typed is in it, neither their account's name nor the
 * listing's: a draft's name is free text nobody reviews, and it would go out from our address to
 * someone who never asked (as the account emails, 2026-10-30). The invite page names the listing,
 * once its reader has signed in.
 */
export const INVITE_EMAIL_COPY: Record<OwnerEmailLocale, InviteCopy> = {
  el: {
    subject: 'Πρόσκληση συνιδιοκτησίας χώρου στάθμευσης στο Parkfairy',
    heading: 'Πρόσκληση συνιδιοκτησίας',
    body: 'Σας προσκαλούν να συμμετέχετε στην ιδιοκτησία ενός χώρου στάθμευσης στο Parkfairy.',
    action: 'Δείτε την πρόσκληση',
    note: `Ο σύνδεσμος ισχύει για ${INVITE_EMAIL_DAYS} ημέρες. Για να αποδεχτείτε, συνδεθείτε ή δημιουργήστε λογαριασμό με αυτή τη διεύθυνση email. Αν δεν περιμένατε αυτή την πρόσκληση, μπορείτε να την αγνοήσετε.`,
    linkFallback: 'Αν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο στον περιηγητή σας:',
    footer:
      'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή αυτή η διεύθυνση προσκλήθηκε σε συνιδιοκτησία χώρου στο Parkfairy.',
  },
  en: {
    subject: 'An invitation to co-own a parking listing on Parkfairy',
    heading: 'You’re invited to co-own a listing',
    body: 'You’re invited to co-own a parking listing on Parkfairy.',
    action: 'See the invitation',
    note: `The link works for ${INVITE_EMAIL_DAYS} days. To accept, sign in, or create an account, with this email address. If you weren’t expecting this invitation, you can ignore it.`,
    linkFallback: 'If the button doesn’t work, copy this link into your browser:',
    footer:
      'Parkfairy. You’re receiving this because this address was invited to co-own a parking listing on Parkfairy.',
  },
};

export interface InviteEmail {
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
  /** The link's token, minted as the email is sent; it goes after `#`, so no server logs it. */
  token: string;
}

export function renderInviteEmail({ to, locale, webUrl, token }: InviteEmail): OutgoingEmail {
  const copy = INVITE_EMAIL_COPY[locale];
  const url = new URL(`/${locale}/owner/invite`, webUrl);
  url.hash = token;
  return renderEmail({
    to,
    locale,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    action: copy.action,
    url: url.toString(),
    note: copy.note,
    linkFallback: copy.linkFallback,
    footer: copy.footer,
  });
}
