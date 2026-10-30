// @vitest-environment node
import type { AuthEmail } from '@parkfairy/auth';
import { describe, expect, it, vi } from 'vitest';
import el from '@/messages/el.json';
import en from '@/messages/en.json';

vi.mock('server-only', () => ({}));
const { renderAuthEmail } = await import('./render');

const catalogs = { el, en };
const url = 'https://parkfairy.example/api/auth/verify-email?token=a.b-c&callbackURL=%2Fel';
const kinds = [
  ['verify-email', 'verifyEmail'],
  ['reset-password', 'resetPassword'],
  ['password-changed', 'passwordChanged'],
  ['existing-account', 'existingAccount'],
] as const;
const locales = ['el', 'en'] as const;
const render = (kind: AuthEmail['kind'], locale: AuthEmail['locale'], link = url) =>
  renderAuthEmail({ kind, to: 'maria@example.gr', locale, url: link });

describe('renderAuthEmail', () => {
  describe.each(locales)('%s', (locale) => {
    it.each(kinds)('%s reads in the account language', (kind, section) => {
      const copy = catalogs[locale].Email[section];
      const email = render(kind, locale);

      expect(email.to).toBe('maria@example.gr');
      expect(email.subject).toBe(copy.subject);
      expect(email.text).toContain(copy.heading);
      expect(email.text).toContain(copy.note);
      expect(email.html).toContain(`<html lang="${locale}">`);
      // Webmail drops <html>: the content must carry the language itself.
      expect(email.html).toContain(`<table role="presentation" lang="${locale}"`);
      expect(email.html).toContain(`<p lang="${locale}"`);
      expect(email.html).toContain(`<h1 `);
      expect(email.html).toContain(copy.action);
    });

    it.each(kinds)('%s works as plain text, with its link', (kind) => {
      expect(render(kind, locale).text).toContain(url);
      expect(render(kind, locale).text).not.toContain('<');
    });

    it.each(kinds)('%s puts every line of its copy in both parts', (kind, section) => {
      const copy = catalogs[locale].Email[section];
      const { text, html } = render(kind, locale);
      const lifetime = /{(hours|minutes),/.exec(copy.body)?.[1] === 'hours' ? '24' : '60';
      const body = copy.body.replace(/{(hours|minutes), plural.*?}}/, lifetime);

      for (const line of [copy.heading, copy.note, catalogs[locale].Email.footer]) {
        expect(text).toContain(line);
        expect(html).toContain(line);
      }
      expect(text).toContain(body.split(lifetime)[0]);
      expect(html).toContain(body.split(lifetime)[0]);
      expect(text).toContain(`${copy.action}: ${url}`);
      expect(html).toContain(catalogs[locale].Email.linkFallback);
    });

    it.each(kinds)('%s never prints a message key', (kind) => {
      const { subject, text, html } = render(kind, locale);
      expect(subject + text + html).not.toMatch(/\bEmail\.\w/);
    });

    it.each(kinds)('%s gives every text its own colour on a declared background', (kind) => {
      const { html } = render(kind, locale);
      expect(html).toContain('<meta name="supported-color-schemes" content="light">');
      expect(html).toContain('bgcolor="#ffffff"');
      const unstyled = html.match(/<(h1|p) [^>]*style="(?![^"]*color:)[^"]*"/g) ?? [];
      // The one exception wraps the button, whose link sets its own colours.
      expect(unstyled.filter((tag) => !tag.includes('margin:24px 0'))).toEqual([]);
    });

    it.each(kinds)('%s has no unformatted placeholders', (kind) => {
      const { text, html } = render(kind, locale);
      expect(text).not.toMatch(/[{}]/);
      expect(html.replace(/<style[\s\S]*?<\/style>/g, '')).not.toMatch(/\{\w+\}/);
    });
  });

  it('states how long each link works', () => {
    expect(render('verify-email', 'en').text).toContain('24 hours');
    expect(render('verify-email', 'el').text).toContain('24 ώρες');
    expect(render('reset-password', 'en').text).toContain('60 minutes');
    expect(render('reset-password', 'el').text).toContain('60 λεπτά');
  });

  it('escapes the link in the HTML, as a button and as text to copy', () => {
    const { html } = render('verify-email', 'en');
    const escaped = url.replaceAll('&', '&amp;');
    expect(html.split(`href="${escaped}"`)).toHaveLength(3);
    expect(html).not.toContain('token=a.b-c&callbackURL');
  });

  it('cannot be broken out of by a hostile link', () => {
    const { html } = render('verify-email', 'en', 'https://x.example/"><script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('takes no free text from the account: only the address it goes to', () => {
    // The sign-up form's name is attacker-chosen when someone uses a stranger's address.
    const input = {
      kind: 'verify-email',
      to: 'a@b.gr',
      locale: 'en',
      url,
      name: 'Pay https://evil',
    };
    const { text, html } = renderAuthEmail(input as AuthEmail);
    expect(text + html).not.toContain('evil');
  });
});
