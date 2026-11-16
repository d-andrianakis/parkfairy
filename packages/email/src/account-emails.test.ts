import { describe, expect, it } from 'vitest';
import { ACCOUNT_EMAIL_COPY, ACCOUNT_EMAIL_KINDS, renderAccountEmail } from './account-emails.js';

const email = (locale: 'el' | 'en') =>
  renderAccountEmail({
    kind: 'two-factor-removed',
    to: 'eleni@example.gr',
    locale,
    webUrl: 'https://parkfairy.gr',
  });

describe('the account emails', () => {
  it('have copy in both languages for every kind, none of it empty', () => {
    for (const locale of ['el', 'en'] as const) {
      for (const kind of ACCOUNT_EMAIL_KINDS) {
        for (const value of Object.values({ ...ACCOUNT_EMAIL_COPY[locale].kinds[kind] })) {
          expect(value.trim()).not.toBe('');
        }
      }
    }
  });

  it('tell a person their two-factor authentication and password were removed, and what to do', () => {
    const en = email('en');
    expect(en.to).toBe('eleni@example.gr');
    expect(en.subject).toBe('Two-factor authentication was removed from your Parkfairy account');
    expect(en.text).toContain('your password was cancelled too');
    expect(en.text).toContain('contact Parkfairy support straight away');
    const el = email('el');
    expect(el.subject).toBe(
      'Ο έλεγχος ταυτότητας δύο παραγόντων του λογαριασμού σας στο Parkfairy αφαιρέθηκε',
    );
    expect(el.text).toContain('ακυρώθηκε και ο κωδικός πρόσβασής σας');
    expect(el.text).toContain('επικοινωνήστε αμέσως με την υποστήριξη');
  });

  it('send the person to set a new password in their language, not to an account they cannot open', () => {
    for (const locale of ['en', 'el'] as const) {
      const { text, html } = email(locale);
      expect(text).toContain(`https://parkfairy.gr/${locale}/forgot-password`);
      expect(html).toContain(`<a href="https://parkfairy.gr/${locale}/forgot-password"`);
      expect(html).toContain(`lang="${locale}"`);
    }
  });

  it('keeps one link whatever trailing slash the web address has', () => {
    const slash = renderAccountEmail({
      kind: 'two-factor-removed',
      to: 'a@example.gr',
      locale: 'en',
      webUrl: 'https://parkfairy.gr/',
    });
    expect(slash.text).toContain('https://parkfairy.gr/en/forgot-password');
    expect(slash.text).not.toContain('//en/');
  });

  it('say nothing of the check, the note, or who on the staff did it', () => {
    for (const locale of ['en', 'el'] as const) {
      const copy = Object.values({
        ...ACCOUNT_EMAIL_COPY[locale].kinds['two-factor-removed'],
      }).join(' ');
      expect(copy).not.toMatch(/ticket|note|ID card|Support Sam|αιτήματος/i);
    }
  });
});

describe('the suspension emails (#79, #81)', () => {
  const render = (kind: 'account-suspended' | 'account-reinstated', locale: 'el' | 'en') =>
    renderAccountEmail({ kind, to: 'eleni@example.gr', locale, webUrl: 'https://parkfairy.gr' });

  it('tell a person their account is suspended, and that they were signed out, with no reason', () => {
    const en = render('account-suspended', 'en');
    expect(en.subject).toBe('Your Parkfairy account has been suspended');
    expect(en.text).toContain('signed out on every device');
    expect(en.text).toContain('contact Parkfairy support');
    const el = render('account-suspended', 'el');
    expect(el.subject).toBe('Ο λογαριασμός σας στο Parkfairy τέθηκε σε αναστολή');
    expect(el.text).toContain('Αποσυνδεθήκατε από όλες τις συσκευές');
    for (const out of [en, el]) {
      expect(out.text).not.toMatch(/fraud|reason|ticket|απάτη|λόγος/i);
    }
  });

  it('send a suspended person to the site, and a reinstated one to sign in, in their language', () => {
    expect(render('account-suspended', 'en').text).toMatch(/: https:\/\/parkfairy\.gr\/en$/m);
    expect(render('account-suspended', 'el').text).toMatch(/: https:\/\/parkfairy\.gr\/el$/m);
    expect(render('account-reinstated', 'en').text).toContain('https://parkfairy.gr/en/sign-in');
    expect(render('account-reinstated', 'el').text).toContain('https://parkfairy.gr/el/sign-in');
  });

  it('tell a reinstated person their password works again', () => {
    expect(render('account-reinstated', 'en').text).toContain('sign in again with your password');
    expect(render('account-reinstated', 'el').text).toContain('με τον κωδικό πρόσβασής σας');
  });
});
