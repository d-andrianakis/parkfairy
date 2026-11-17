import { LISTING_HANDOVER_DAYS } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';

import {
  HANDOVER_EMAIL_COPY,
  HANDOVER_EMAIL_DAYS,
  HANDOVER_EMAIL_KINDS,
  renderHandoverEmail,
} from './handover-emails.js';

const LISTING = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const email = (kind: (typeof HANDOVER_EMAIL_KINDS)[number], locale: 'el' | 'en') =>
  renderHandoverEmail({
    kind,
    to: 'eleni@example.gr',
    locale,
    webUrl: 'https://parkfairy.gr',
    listingId: LISTING,
  });

describe('the handover emails', () => {
  it('say how long an offer stands as the offer does, in days (a plural in both languages)', () => {
    expect(HANDOVER_EMAIL_DAYS).toBe(LISTING_HANDOVER_DAYS);
    expect(HANDOVER_EMAIL_DAYS).toBeGreaterThan(1);
    expect(email('listing-handover-offered', 'en').text).toContain('lapses after 7 days');
    expect(email('listing-handover-offered', 'el').text).toContain('λήγει σε 7 ημέρες');
  });

  it('link to the listing’s owners page, in the reader’s language', () => {
    for (const kind of HANDOVER_EMAIL_KINDS) {
      expect(email(kind, 'en').text).toContain(
        `https://parkfairy.gr/en/owner/listings/${LISTING}/owners`,
      );
      expect(email(kind, 'el').text).toContain(
        `https://parkfairy.gr/el/owner/listings/${LISTING}/owners`,
      );
    }
  });

  it('tell the co-owner what taking over needs, and the old primary what they keep', () => {
    const offered = email('listing-handover-offered', 'en');
    expect(offered.to).toBe('eleni@example.gr');
    expect(offered.subject).toBe(HANDOVER_EMAIL_COPY.en.kinds['listing-handover-offered'].subject);
    expect(offered.text).toContain('Nothing changes unless you accept');
    expect(offered.text).toContain('completed your details and tax details, and set up payouts');
    const accepted = email('listing-handover-accepted', 'en');
    expect(accepted.text).toContain('You’re now a co-owner, with your share as it was');
    expect(accepted.text).toContain('only the primary owner can now remove owners');
  });

  it('write Greek in the formal register', () => {
    const offered = email('listing-handover-offered', 'el');
    expect(offered.text).toContain('σας πρότεινε να αναλάβετε τον ρόλο του');
    const accepted = email('listing-handover-accepted', 'el');
    expect(accepted.text).toContain('Το μερίδιό σας δεν αλλάζει');
  });

  it('carry nothing an owner typed: the same words for any listing, owner or account name', () => {
    for (const kind of HANDOVER_EMAIL_KINDS) {
      for (const locale of ['el', 'en'] as const) {
        const catalog = HANDOVER_EMAIL_COPY[locale];
        const copy = catalog.kinds[kind];
        const sent = email(kind, locale);
        const ours = [
          copy.subject,
          copy.heading,
          copy.body,
          copy.action,
          copy.note,
          catalog.linkFallback,
          copy.footer,
          `https://parkfairy.gr/${locale}/owner/listings/${LISTING}/owners`,
        ];
        const lines = sent.text
          .split('\n')
          .map((line) => line.trim())
          // Lines with words: the layout's own separators aside.
          .filter((line) => /\p{L}/u.test(line));
        for (const line of lines) {
          expect(
            ours.some((text) => line.includes(text)),
            line,
          ).toBe(true);
        }
      }
    }
  });

  it('keep an id that is not one from reaching the link as anything but a path part', () => {
    const sent = renderHandoverEmail({
      kind: 'listing-handover-offered',
      to: 'eleni@example.gr',
      locale: 'en',
      webUrl: 'https://parkfairy.gr',
      listingId: '../../evil?x=1#y',
    });
    expect(sent.text).toContain('/en/owner/listings/..%2F..%2Fevil%3Fx%3D1%23y/owners');
    expect(sent.text).not.toContain('evil?x=1');
  });

  it('give every kind a copy in both languages', () => {
    for (const locale of ['el', 'en'] as const) {
      expect(Object.keys(HANDOVER_EMAIL_COPY[locale].kinds).sort()).toEqual(
        [...HANDOVER_EMAIL_KINDS].sort(),
      );
    }
  });
});
