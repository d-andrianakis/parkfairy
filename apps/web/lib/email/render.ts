import 'server-only';
import type { AuthEmail } from '@parkfairy/auth';
import { ACCOUNT_LINK_LIFETIME } from '@parkfairy/contracts';
import { createTranslator } from 'next-intl';
import el from '@/messages/el.json';
import en from '@/messages/en.json';
import type { OutgoingEmail } from './transport';

const CATALOGS = { el, en };

/** The light theme's `--primary`, held to it by tokens.test.ts: mail clients can't read our CSS. */
const PRIMARY = '#092c99';

/** The catalog section of each kind of email; every section has the same keys. */
const SECTIONS = {
  'verify-email': 'verifyEmail',
  'reset-password': 'resetPassword',
  'password-changed': 'passwordChanged',
  'existing-account': 'existingAccount',
} as const satisfies Record<AuthEmail['kind'], string>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/*
 * The body is built only from catalog text and our own link. The account name is left out on
 * purpose: anyone can sign up with someone else's address, and a name is free text they would
 * get to put in front of that person, from our domain.
 */
export function renderAuthEmail({ kind, to, locale, url }: AuthEmail): OutgoingEmail {
  const t = createTranslator({
    locale,
    messages: CATALOGS[locale],
    namespace: `Email.${SECTIONS[kind]}`,
  });
  const shared = createTranslator({ locale, messages: CATALOGS[locale], namespace: 'Email' });

  const lifetime = {
    hours: ACCOUNT_LINK_LIFETIME.verifyEmailHours,
    minutes: ACCOUNT_LINK_LIFETIME.resetPasswordMinutes,
  };
  const subject = t('subject');
  const heading = t('heading');
  const paragraphs = [t('body', lifetime), t('note')];
  const action = t('action');
  const footer = shared('footer');

  const text = [heading, paragraphs[0], `${action}: ${url}`, paragraphs[1], '--', footer].join(
    '\n\n',
  );

  const link = escapeHtml(url);
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#0f172a">${escapeHtml(paragraph ?? '')}</p>`,
    )
    .join('');
  // Inline styles and a presentation table: what mail clients render consistently. Every text
  // has its own colour (slate-900 on white, white on the primary), because clients drop the styles
  // on <body>. The colour-scheme tags ask for no automatic dark mode, but some clients recolour
  // anyway, so check real ones. `lang` repeats on the content because webmail drops the <html>
  // element, and a screen reader needs it for the Greek.
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>:root{color-scheme:light only}</style>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 16px;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" lang="${locale}" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td bgcolor="#ffffff" style="padding:32px 24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(heading)}</h1>
${body}
<p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;background:${PRIMARY};color:#ffffff;font-size:16px;font-weight:bold;text-decoration:underline;border-radius:6px">${escapeHtml(action)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#475569">${escapeHtml(shared('linkFallback'))}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:${PRIMARY};word-break:break-all"><a href="${link}" style="color:${PRIMARY}">${link}</a></p>
</td></tr>
</table>
<p lang="${locale}" style="max-width:520px;margin:16px auto 0;font-size:13px;line-height:1.5;color:#475569">${escapeHtml(footer)}</p>
</body>
</html>
`;
  return { to, subject, text, html };
}
