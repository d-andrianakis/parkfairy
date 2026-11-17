import { LISTING_HANDOVER_DAYS } from '@parkfairy/contracts';

import { renderEmail } from './layout.js';
import type { OwnerEmailLocale } from './owner-emails.js';
import type { OutgoingEmail } from './transport.js';

export const HANDOVER_EMAIL_KINDS = [
  'listing-handover-offered',
  'listing-handover-accepted',
] as const;
export type HandoverEmailKind = (typeof HANDOVER_EMAIL_KINDS)[number];

/** How long an offer stands, as the email says it. The copy's "days" is plural: a test holds it above one. */
export const HANDOVER_EMAIL_DAYS = LISTING_HANDOVER_DAYS;

interface HandoverCopy {
  subject: string;
  heading: string;
  body: string;
  action: string;
  note: string;
}

interface HandoverCatalog {
  linkFallback: string;
  kinds: Record<HandoverEmailKind, HandoverCopy & { footer: string }>;
}

/**
 * The two emails of handing over a listing's primary role (#61–#64): to the co-owner when they are
 * offered it, and to the primary who gave it up when it is accepted. The worker sends them, so the
 * copy lives here, as the invite's does: formal "you" in Greek, no gendered words for anyone,
 * listed for the native-speaker pass. Nothing an owner typed is in them, neither anyone's name nor
 * the listing's (a draft's name is free text nobody reviews, and the email goes out from our
 * address): the page they link to names both, once its reader has signed in.
 */
export const HANDOVER_EMAIL_COPY: Record<OwnerEmailLocale, HandoverCatalog> = {
  el: {
    linkFallback: 'Αν το κουμπί δεν λειτουργεί, αντιγράψτε αυτόν τον σύνδεσμο στον περιηγητή σας:',
    kinds: {
      'listing-handover-offered': {
        subject: 'Σας προτάθηκε ο ρόλος του κύριου ιδιοκτήτη ενός χώρου στο Parkfairy',
        heading: 'Σας προτάθηκε ο ρόλος του κύριου ιδιοκτήτη',
        body: 'Ο κύριος ιδιοκτήτης ενός χώρου στάθμευσης που συνιδιοκτείτε στο Parkfairy σας πρότεινε να αναλάβετε τον ρόλο του.',
        action: 'Δείτε την πρόταση',
        note: `Τίποτα δεν αλλάζει αν δεν την αποδεχτείτε. Η πρόταση λήγει σε ${HANDOVER_EMAIL_DAYS} ημέρες. Για να αναλάβετε, χρειάζεται να έχετε συμπληρώσει «Τα στοιχεία σας» και «Φορολογικά στοιχεία» και να έχετε ρυθμίσει τις πληρωμές προς εσάς.`,
        footer:
          'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή συνιδιοκτείτε έναν χώρο στάθμευσης στο Parkfairy.',
      },
      'listing-handover-accepted': {
        subject: 'Ο χώρος σας έχει νέο κύριο ιδιοκτήτη',
        heading: 'Ο ρόλος του κύριου ιδιοκτήτη παραδόθηκε',
        body: 'Ένα μέλος αποδέχτηκε τον ρόλο του κύριου ιδιοκτήτη ενός χώρου στάθμευσης στο Parkfairy, στον οποίο είχατε εσείς αυτόν τον ρόλο. Πλέον συμμετέχετε στην ιδιοκτησία του με το ίδιο μερίδιο.',
        action: 'Δείτε τους ιδιοκτήτες του χώρου',
        note: 'Το μερίδιό σας δεν αλλάζει, αλλά μόνο ο κύριος ιδιοκτήτης μπορεί πλέον να αφαιρεί μέλη, να ορίζει τα μερίδια, να ανοίγει τα έγγραφα και να διαγράφει τον χώρο.',
        footer:
          'Parkfairy. Λαμβάνετε αυτό το μήνυμα επειδή είχατε τον ρόλο του κύριου ιδιοκτήτη ενός χώρου στο Parkfairy.',
      },
    },
  },
  en: {
    linkFallback: 'If the button doesn’t work, copy this link into your browser:',
    kinds: {
      'listing-handover-offered': {
        subject: 'You’ve been offered the primary role of a listing on Parkfairy',
        heading: 'You’ve been offered the primary role',
        body: 'The primary owner of a parking listing you co-own on Parkfairy has offered you their role.',
        action: 'See the offer',
        note: `Nothing changes unless you accept. The offer lapses after ${HANDOVER_EMAIL_DAYS} days. To take over, you need to have completed your details and tax details, and set up payouts.`,
        footer:
          'Parkfairy. You’re receiving this because you co-own a parking listing on Parkfairy.',
      },
      'listing-handover-accepted': {
        subject: 'Your listing has a new primary owner',
        heading: 'The primary role has been handed over',
        body: 'A co-owner has accepted the primary role of a parking listing you owned on Parkfairy. You’re now a co-owner, with your share as it was.',
        action: 'See the listing’s owners',
        note: 'You keep your share, but only the primary owner can now remove owners, set the shares, open the deeds and delete the listing.',
        footer:
          'Parkfairy. You’re receiving this because you were the primary owner of a parking listing on Parkfairy.',
      },
    },
  },
};

export interface HandoverEmail {
  kind: HandoverEmailKind;
  to: string;
  locale: OwnerEmailLocale;
  /** The web app's origin. */
  webUrl: string;
  /** The listing, whose owners page the button opens: an id, which no owner typed. */
  listingId: string;
}

export function renderHandoverEmail({
  kind,
  to,
  locale,
  webUrl,
  listingId,
}: HandoverEmail): OutgoingEmail {
  const catalog = HANDOVER_EMAIL_COPY[locale];
  const copy = catalog.kinds[kind];
  return renderEmail({
    to,
    locale,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    action: copy.action,
    url: new URL(
      `/${locale}/owner/listings/${encodeURIComponent(listingId)}/owners`,
      webUrl,
    ).toString(),
    note: copy.note,
    linkFallback: catalog.linkFallback,
    footer: copy.footer,
  });
}
