import { describe, expect, it } from 'vitest';
import { BOOKING_EMAIL_COPY } from './booking-emails.js';
import { renderEmail, sentenceWith } from './layout.js';
import { OWNER_EMAIL_COPY, OWNER_EMAIL_LOCALES } from './owner-emails.js';

const NAME = 'Γκαράζ “Ερμού” & Co';

describe('sentenceWith', () => {
  it('keeps the name apart wherever it falls, with nothing empty around it', () => {
    expect(sentenceWith((name) => `${name} is live.`, 'Lot', 'en')).toEqual([
      { text: 'Lot', lang: 'en' },
      { text: ' is live.' },
    ]);
    expect(sentenceWith((name) => `Bookings for ${name}`, 'Lot', 'en')).toEqual([
      { text: 'Bookings for ' },
      { text: 'Lot', lang: 'en' },
    ]);
  });

  it('gives each place the name appears its own part, and none where it doesn’t', () => {
    expect(sentenceWith((name) => `${name}, or ${name}?`, 'Lot', 'en')).toEqual([
      { text: 'Lot', lang: 'en' },
      { text: ', or ' },
      { text: 'Lot', lang: 'en' },
      { text: '?' },
    ]);
    expect(sentenceWith(() => 'No name here.', 'Lot', 'en')).toEqual([{ text: 'No name here.' }]);
  });

  it('never splits the name itself, whatever it holds', () => {
    expect(sentenceWith((name) => `At ${name}.`, 'a\u{E000}b', 'el')).toEqual([
      { text: 'At ' },
      { text: 'a\u{E000}b', lang: 'el' },
      { text: '.' },
    ]);
  });

  // The rule it relies on: every catalog sentence puts its name in as it is.
  const bodies = OWNER_EMAIL_LOCALES.flatMap((locale) => [
    ...Object.entries(BOOKING_EMAIL_COPY[locale].kinds).map(
      ([kind, copy]) => [`${locale} ${kind}`, copy.body] as const,
    ),
    ...Object.entries(OWNER_EMAIL_COPY[locale].kinds).map(
      ([kind, copy]) => [`${locale} ${kind}`, copy.body] as const,
    ),
  ]);
  it.each(bodies)('reads back as the catalog wrote it: %s', (_kind, body) => {
    const parts = sentenceWith(body, NAME, 'en');
    expect(parts.map(({ text }) => text).join('')).toBe(body(NAME));
    expect(body(NAME)).not.toContain('\u{E000}');
  });
});

describe('renderEmail', () => {
  const base = {
    to: 'someone@example.gr',
    subject: 'Subject',
    heading: 'Heading',
    action: 'Open',
    url: 'https://parkfairy.example/en',
    note: '',
    linkFallback: 'Copy the link',
    footer: 'Parkfairy',
  };

  it('marks a part in another language, and Greek words in English, in the HTML only', () => {
    const email = renderEmail({
      ...base,
      locale: 'en',
      body: [{ text: 'At “' }, { text: 'Γκαράζ', lang: 'el' }, { text: '”, by Σύνταγμα.' }],
    });
    expect(email.html).toContain(
      'At “<span lang="el">Γκαράζ</span>”, by <span lang="el">Σύνταγμα</span>.',
    );
    expect(email.text).toContain('At “Γκαράζ”, by Σύνταγμα.');
  });

  it('marks nothing it doesn’t know in a Greek email', () => {
    const email = renderEmail({ ...base, locale: 'el', body: 'Στο Central Garage.' });
    expect(email.html).toContain('>Στο Central Garage.</p>');
  });
});
