import { describe, expect, it } from 'vitest';
import { LISTING_INVITE_DAYS } from '@parkfairy/contracts';
import { INVITE_EMAIL_COPY, INVITE_EMAIL_DAYS, renderInviteEmail } from './invite-email.js';

const TOKEN = 'Abc_def-0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, 43);
const email = (locale: 'el' | 'en') =>
  renderInviteEmail({
    to: 'eleni@example.gr',
    locale,
    webUrl: 'https://parkfairy.gr',
    token: TOKEN,
  });

describe('the invite email', () => {
  it('says how long its link works as the invite does, in days (a plural in both languages)', () => {
    expect(INVITE_EMAIL_DAYS).toBe(LISTING_INVITE_DAYS);
    expect(INVITE_EMAIL_DAYS).toBeGreaterThan(1);
  });

  it('links to the invite page with its token after the #, so no server logs it', () => {
    const sent = email('en');
    expect(sent.to).toBe('eleni@example.gr');
    expect(sent.text).toContain(`https://parkfairy.gr/en/owner/invite#${TOKEN}`);
    expect(sent.text).toContain('You’re invited to co-own a parking listing on Parkfairy.');
    expect(sent.text).toContain('The link works for 7 days');
    // A new person needs an account first.
    expect(sent.text).toContain('sign in, or create an account, with this email address');
    expect(sent.subject).toBe(INVITE_EMAIL_COPY.en.subject);
  });

  it('writes Greek with nobody’s gender, and names no one who invited', () => {
    const sent = email('el');
    expect(sent.text).toContain(
      'Σας προσκαλούν να συμμετέχετε στην ιδιοκτησία ενός χώρου στάθμευσης στο Parkfairy.',
    );
    expect(sent.text).toContain(`/el/owner/invite#${TOKEN}`);
    // The footer names no one who invited: "this address was invited".
    expect(sent.text).toContain('αυτή η διεύθυνση προσκλήθηκε');
  });

  it('carries nothing an owner typed: the same words whoever sends it, for whatever listing', () => {
    for (const locale of ['el', 'en'] as const) {
      const copy = INVITE_EMAIL_COPY[locale];
      const sent = email(locale);
      // Every line of text is ours: the copy, the link, and the address it goes to.
      const ours = [
        copy.subject,
        copy.heading,
        copy.body,
        copy.action,
        copy.note,
        copy.linkFallback,
        copy.footer,
        `https://parkfairy.gr/${locale}/owner/invite#${TOKEN}`,
      ];
      const lines = sent.text
        .split('\n')
        .map((line) => line.trim())
        // Lines with words: the layout's own separators aside.
        .filter((line) => /\p{L}/u.test(line));
      for (const line of lines)
        expect(
          ours.some((text) => line.includes(text)),
          line,
        ).toBe(true);
    }
  });
});
