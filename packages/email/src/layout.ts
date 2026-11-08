import type { OutgoingEmail } from './transport.js';

/** The light theme's `--primary`, held to it by tokens.test.ts: mail clients can't read our CSS. */
export const PRIMARY = '#092c99';

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export interface EmailContent {
  to: string;
  locale: string;
  subject: string;
  heading: string;
  /** The text before the button. */
  body: string;
  /** Facts set out after the body, label beside value: a booking's place and times. */
  details?: { label: string; value: string; lang?: string | undefined }[];
  action: string;
  url: string;
  /** The text after the button's link, in the plain-text version. */
  note: string;
  /** "If the button doesn't work…" */
  linkFallback: string;
  footer: string;
}

/** One message with one button, in plain text and HTML. */
export function renderEmail({
  to,
  locale,
  subject,
  heading,
  body,
  details = [],
  action,
  url,
  note,
  linkFallback,
  footer,
}: EmailContent): OutgoingEmail {
  const facts = details.map(({ label, value }) => `${label}: ${value}`).join('\n');
  const text = [heading, body, facts, `${action}: ${url}`, note, '--', footer]
    .filter(Boolean)
    .join('\n\n');

  const link = escapeHtml(url);
  // Label beside value, which a screen reader reads as pairs; a table is what every client keeps.
  const table =
    details.length === 0
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#0f172a">${details
          .map(
            ({ label, value, lang }) =>
              `<tr><td style="padding:2px 16px 2px 0;vertical-align:top;font-weight:bold;color:#0f172a">${escapeHtml(label)}</td><td${lang ? ` lang="${escapeHtml(lang)}"` : ''} style="padding:2px 0;vertical-align:top;color:#0f172a">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}</table>\n`;
  const paragraph = (content: string) =>
    content
      ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#0f172a">${escapeHtml(content)}</p>`
      : '';
  // The facts belong to the body, before the note that follows them.
  const paragraphs = `${paragraph(body)}\n${table}${paragraph(note)}`;
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
${paragraphs}
<p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;background:${PRIMARY};color:#ffffff;font-size:16px;font-weight:bold;text-decoration:underline;border-radius:6px">${escapeHtml(action)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#475569">${escapeHtml(linkFallback)}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:${PRIMARY};word-break:break-all"><a href="${link}" style="color:${PRIMARY}">${link}</a></p>
</td></tr>
</table>
<p lang="${locale}" style="max-width:520px;margin:16px auto 0;font-size:13px;line-height:1.5;color:#475569">${escapeHtml(footer)}</p>
</body>
</html>
`;
  return { to, subject, text, html };
}
