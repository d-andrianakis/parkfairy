import { renderEmail, type TextPart } from './layout.js';
import type { OwnerEmailLocale } from './owner-emails.js';
import type { OutgoingEmail } from './transport.js';

/** How long the link works, as the email says it (LISTING_INVITE_DAYS in contracts). */
const DAYS = 7;

interface InviteCopy {
  subject: string;
  heading: string;
  /** With who invited and the listing's name; each kept apart so its language can be marked. */
  body: { before: string; between: string; after: string };
  /** Without a name for who invited (they have left since). */
  bodyNoInviter: { before: string; after: string };
  action: string;
  note: string;
  linkFallback: string;
  footer: string;
}

/**
 * The invite to own a listing with its owners (#56). The worker sends it, so the copy lives here,
 * as the owners' does: formal "you" in Greek, no gendered words for either person, listed for the
 * native-speaker pass. The subject names nobody: names are typed by people, and a subject is what
 * a stranger's inbox shows first.
 */
export const INVITE_EMAIL_COPY: Record<OwnerEmailLocale, InviteCopy> = {
  el: {
    subject: 'Πρόσκληση συνιδιοκτησίας χώρου στάθμευσης στο Parkfairy',
    heading: 'Πρόσκληση συνιδιοκτησίας',
    body: {
      before: '',
      between: ' σας προσκαλεί να συμμετέχετε στην ιδιοκτησία του χώρου «',
      after: '» στο Parkfairy.',
    },
    bodyNoInviter: {
      before: 'Σας προσκαλούν να συμμετέχετε στην ιδιοκτησία του χώρου «',
      after: '» στο Parkfairy.',
    },
    action: 'Δείτε την πρόσκληση',
    note: `Ο σύνδεσμος ισχύει για ${DAYS} ημέρες. Για να αποδεχτείτε, συνδεθείτε με αυτή τη διεύθυνση email. Αν δεν περιμένατε αυτή την πρόσκληση, μπορείτε να την αγνοήσετε.`,
    linkFallback: 'Αν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο στον περιηγητή σας:',
    footer:
      'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή ένας ιδιοκτήτης χώρου στο Parkfairy προσκάλεσε αυτή τη διεύθυνση.',
  },
  en: {
    subject: 'An invitation to co-own a parking listing on Parkfairy',
    heading: 'You’re invited to co-own a listing',
    body: {
      before: '',
      between: ' invites you to own “',
      after: '” with its owners on Parkfairy.',
    },
    bodyNoInviter: {
      before: 'You’re invited to own “',
      after: '” with its owners on Parkfairy.',
    },
    action: 'See the invitation',
    note: `The link works for ${DAYS} days. To accept, sign in with this email address. If you weren’t expecting this invitation, you can ignore it.`,
    linkFallback: 'If the button doesn’t work, copy this link into your browser:',
    footer:
      'Parkfairy. You’re receiving this because a parking owner on Parkfairy invited this address.',
  },
};

export interface InviteEmail {
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
  /** The link's token, minted as the email is sent; it goes after `#`, so no server logs it. */
  token: string;
  listingName?: string | undefined;
  /** The language the listing is written in, for `lang` on its name. */
  contentLocale?: string | undefined;
  inviterName?: string | undefined;
}

export function renderInviteEmail({
  to,
  locale,
  webUrl,
  token,
  listingName = '',
  contentLocale,
  inviterName,
}: InviteEmail): OutgoingEmail {
  const copy = INVITE_EMAIL_COPY[locale];
  const listing: TextPart = { text: listingName, lang: listingName ? contentLocale : undefined };
  const body: TextPart[] = (
    inviterName
      ? [
          { text: copy.body.before },
          { text: inviterName },
          { text: copy.body.between },
          listing,
          { text: copy.body.after },
        ]
      : [{ text: copy.bodyNoInviter.before }, listing, { text: copy.bodyNoInviter.after }]
  ).filter(({ text }) => text);
  const url = new URL(`/${locale}/owner/invite`, webUrl);
  url.hash = token;
  return renderEmail({
    to,
    locale,
    subject: copy.subject,
    heading: copy.heading,
    body,
    action: copy.action,
    url: url.toString(),
    note: copy.note,
    linkFallback: copy.linkFallback,
    footer: copy.footer,
  });
}
