import { describe, expect, it } from 'vitest';
import {
  OWNER_EMAIL_COPY,
  OWNER_EMAIL_KINDS,
  OWNER_EMAIL_LOCALES,
  renderOwnerEmail,
} from './owner-emails.js';

const base = { to: 'owner@example.gr', webUrl: 'https://parkfairy.example', locale: 'el' } as const;

describe('renderOwnerEmail', () => {
  it.each(
    OWNER_EMAIL_LOCALES.flatMap((locale) => OWNER_EMAIL_KINDS.map((k) => [locale, k] as const)),
  )('%s %s has a subject, a body and a link to the dashboard', (locale, kind) => {
    const email = renderOwnerEmail({ ...base, locale, kind, listingName: 'Γκαράζ' });
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.html).toContain(`lang="${locale}"`);
    expect(email.text).toContain(`https://parkfairy.example/${locale}/owner`);
    expect(email.html).toContain(`href="https://parkfairy.example/${locale}/owner"`);
  });

  it('names the listing in the emails about one', () => {
    for (const kind of [
      'listing-submitted',
      'listing-approved',
      'listing-changes-requested',
    ] as const) {
      expect(renderOwnerEmail({ ...base, kind, listingName: 'Γκαράζ Ερμού' }).text).toContain(
        'Γκαράζ Ερμού',
      );
    }
  });

  it('escapes a listing name in the HTML, so an owner can’t inject markup', () => {
    const email = renderOwnerEmail({
      ...base,
      kind: 'listing-approved',
      listingName: '<img src=x onerror=alert(1)>',
    });
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img');
  });

  it('builds the link from the origin, whatever trails it', () => {
    const email = renderOwnerEmail({
      ...base,
      webUrl: 'https://parkfairy.example/',
      kind: 'onboarding-reminder',
    });
    expect(email.text).toContain('https://parkfairy.example/el/owner');
    expect(email.text).not.toContain('//el');
  });
});

describe('copy', () => {
  it('uses Greek in the Greek copy and none in the English', () => {
    const greek = /\p{Script=Greek}/u;
    for (const kind of OWNER_EMAIL_KINDS) {
      expect(OWNER_EMAIL_COPY.el.kinds[kind].subject).toMatch(greek);
      expect(OWNER_EMAIL_COPY.el.kinds[kind].body('x')).toMatch(greek);
      expect(OWNER_EMAIL_COPY.en.kinds[kind].subject).not.toMatch(greek);
      expect(OWNER_EMAIL_COPY.en.kinds[kind].body('x')).not.toMatch(greek);
    }
  });
});
