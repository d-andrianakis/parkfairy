import { describe, expect, it } from 'vitest';
import { INVITE_EMAIL_COPY, renderInviteEmail } from './invite-email.js';

const TOKEN = 'Abc_def-0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, 43);

describe('the invite email', () => {
  it('links to the invite page with its token after the #, so no server logs it', () => {
    const email = renderInviteEmail({
      to: 'eleni@example.gr',
      locale: 'en',
      webUrl: 'https://parkfairy.gr',
      token: TOKEN,
      listingName: 'Ermou Garage',
      contentLocale: 'en',
      inviterName: 'Maria',
    });
    expect(email.to).toBe('eleni@example.gr');
    expect(email.text).toContain(`https://parkfairy.gr/en/owner/invite#${TOKEN}`);
    expect(email.text).toContain('Maria invites you to own “Ermou Garage” with its owners');
    expect(email.text).toContain('The link works for 7 days');
    // Nobody's typed name in the subject.
    expect(email.subject).toBe(INVITE_EMAIL_COPY.en.subject);
    expect(email.subject).not.toContain('Maria');
  });

  it('writes Greek with the listing’s name marked in its language, and nobody’s gender', () => {
    const email = renderInviteEmail({
      to: 'eleni@example.gr',
      locale: 'el',
      webUrl: 'https://parkfairy.gr',
      token: TOKEN,
      listingName: 'City Parking',
      contentLocale: 'en',
      inviterName: 'Μαρία',
    });
    expect(email.text).toContain(
      'Μαρία σας προσκαλεί να συμμετέχετε στην ιδιοκτησία του χώρου «City Parking» στο Parkfairy.',
    );
    expect(email.html).toContain('<span lang="en">City Parking</span>');
    expect(email.text).toContain(`/el/owner/invite#${TOKEN}`);
  });

  it('says who invited only when it knows, and escapes what people typed', () => {
    const email = renderInviteEmail({
      to: 'eleni@example.gr',
      locale: 'en',
      webUrl: 'https://parkfairy.gr',
      token: TOKEN,
      listingName: '<b>Garage</b>',
      contentLocale: 'en',
    });
    expect(email.text).toContain('You’re invited to own “<b>Garage</b>” with its owners');
    expect(email.html).not.toContain('<b>Garage</b>');
    expect(email.html).toContain('&lt;b&gt;Garage&lt;/b&gt;');
  });
});
