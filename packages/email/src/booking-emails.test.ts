import { describe, expect, it } from 'vitest';
import {
  BOOKING_EMAIL_COPY,
  BOOKING_EMAIL_KINDS,
  renderBookingEmail,
  type BookingEmailFacts,
} from './booking-emails.js';
import { OWNER_EMAIL_LOCALES } from './owner-emails.js';

const booking: BookingEmailFacts = {
  id: '6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c',
  listingId: '0b7f2a1c-3d4e-4f5a-8b6c-7d8e9f0a1b2c',
  reference: 'K7M4-Q2ZD',
  address: 'Ερμού 1, Αθήνα',
  spaceLabel: 'A1',
  // 10:00 to 12:30 in Athens (winter time, UTC+2).
  start: '2026-12-10T08:00:00.000Z',
  end: '2026-12-10T10:30:00.000Z',
  timeZone: 'Europe/Athens',
  totalMinor: 1250,
  currency: 'EUR',
};
const base = { to: 'someone@example.gr', webUrl: 'https://parkfairy.example', booking } as const;

describe('renderBookingEmail', () => {
  it.each(
    OWNER_EMAIL_LOCALES.flatMap((locale) => BOOKING_EMAIL_KINDS.map((k) => [locale, k] as const)),
  )('%s %s sets out the booking and links to it', (locale, kind) => {
    const email = renderBookingEmail({ ...base, locale, kind, listingName: 'Γκαράζ Ερμού' });
    expect(email.html).toContain(`lang="${locale}"`);
    for (const fact of ['Γκαράζ Ερμού', 'Ερμού 1, Αθήνα', 'A1', 'K7M4-Q2ZD']) {
      expect(email.text).toContain(fact);
      expect(email.html).toContain(fact);
    }
    const path =
      kind.startsWith('booking-cancelled-by') || kind === 'booking-received'
        ? `/${locale}/owner/listings/${booking.listingId}/bookings`
        : `/${locale}/bookings/${booking.id}`;
    expect(email.text).toContain(`https://parkfairy.example${path}`);
    expect(email.html).toContain(`href="https://parkfairy.example${path}"`);
  });

  it('writes the stay in the listing’s zone, on a 24-hour clock in Greek', () => {
    const greek = renderBookingEmail({ ...base, locale: 'el', kind: 'booking-confirmed' });
    expect(greek.text).toMatch(/10:00/);
    expect(greek.text).toMatch(/12:30/);
    expect(greek.text).not.toMatch(/π\.μ\.|μ\.μ\./);
    expect(greek.text).toContain('12,50');
    const english = renderBookingEmail({ ...base, locale: 'en', kind: 'booking-confirmed' });
    expect(english.text).toMatch(/10:00/);
    expect(english.text).toContain('€12.50');
  });

  it('tells the driver what comes back, and the owner nothing of it', () => {
    const cancelled = { ...booking, refundMinor: 625, cancelledBy: 'driver' as const };
    const driver = renderBookingEmail({
      ...base,
      booking: cancelled,
      locale: 'en',
      kind: 'booking-cancelled',
    });
    expect(driver.text).toContain('Refund: €6.25');
    const owner = renderBookingEmail({
      ...base,
      booking: cancelled,
      locale: 'en',
      kind: 'booking-cancelled-by-driver',
    });
    expect(owner.text).not.toContain('Refund');
  });

  it('says so when the owner called it off', () => {
    const email = renderBookingEmail({
      ...base,
      booking: { ...booking, refundMinor: 1250, cancelledBy: 'owner' },
      locale: 'en',
      kind: 'booking-cancelled',
    });
    expect(email.text).toContain('The owner cancelled your booking');
    expect(email.text).toContain('full amount');
  });

  it('escapes the owner’s words in the HTML', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-received',
      listingName: '<script>alert(1)</script>',
      booking: { ...booking, address: '<b>x</b>' },
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>x');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('names a listing with no name generically, and leaves a missing address out', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-confirmed',
      booking: { ...booking, address: null },
    });
    expect(email.text).toContain('Parking: Unnamed parking');
    expect(email.text).not.toContain('Address');
  });
});

describe('the owner’s words', () => {
  it('are marked up in the listing’s language, in an email in the reader’s', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-confirmed',
      listingName: 'Γκαράζ Ερμού',
      booking: { ...booking, contentLocale: 'el' },
    });
    expect(email.html).toContain(
      '<td lang="el" style="padding:2px 0;vertical-align:top;color:#0f172a">Γκαράζ Ερμού</td>',
    );
    expect(email.html).toContain(
      'lang="el" style="padding:2px 0;vertical-align:top;color:#0f172a">Ερμού 1, Αθήνα',
    );
    // Our own words aren't the owner's.
    expect(email.html).not.toContain(
      'lang="el" style="padding:2px 0;vertical-align:top;color:#0f172a">K7M4-Q2ZD',
    );
    // And in the sentence that names it.
    expect(email.html).toContain('Your space at “<span lang="el">Γκαράζ Ερμού</span>” is booked.');
    expect(email.text).toContain('Your space at “Γκαράζ Ερμού” is booked.');
  });

  it('mark Greek words inside an English listing’s, whichever language the email is in', () => {
    const facts = {
      ...booking,
      contentLocale: 'en',
      address: 'Ermou 1, Σύνταγμα, Athens',
      spaceLabel: 'Α1',
    };
    const english = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-received',
      listingName: 'Garage by Πλατεία Συντάγματος',
      booking: facts,
    });
    expect(english.html).toContain(
      '<td lang="en" style="padding:2px 0;vertical-align:top;color:#0f172a">Ermou 1, <span lang="el">Σύνταγμα</span>, Athens</td>',
    );
    // A Greek alpha in a space's label too.
    expect(english.html).toContain('color:#0f172a"><span lang="el">Α1</span></td>');
    // The name is the email's language already: only its Greek words are marked.
    expect(english.html).toContain(
      'A driver has booked a space at “Garage by <span lang="el">Πλατεία Συντάγματος</span>”.',
    );
    expect(english.text).toContain('Address: Ermou 1, Σύνταγμα, Athens');

    // In Greek the name is English, Greek words and all: nothing is marked inside it.
    const greek = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-received',
      listingName: 'Garage by Πλατεία Συντάγματος',
      booking: facts,
    });
    expect(greek.html).toContain(
      'στον χώρο «<span lang="en">Garage by <span lang="el">Πλατεία Συντάγματος</span></span>».',
    );
    expect(greek.html).toContain(
      '<td lang="en" style="padding:2px 0;vertical-align:top;color:#0f172a">Ermou 1, <span lang="el">Σύνταγμα</span>, Athens</td>',
    );
  });

  it('leave a listing with no name, and our own facts, in the email’s language', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-confirmed',
      booking: { ...booking, contentLocale: 'el' },
    });
    expect(email.html).toContain('Your space at “Unnamed parking” is booked.');
    expect(email.html).toContain(
      '<td style="padding:2px 0;vertical-align:top;color:#0f172a">Unnamed parking</td>',
    );
  });

  it('are escaped wherever they are marked', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-confirmed',
      listingName: '<b>Γκαράζ</b> & "Co"',
      booking: { ...booking, contentLocale: 'en', address: '<img src=x> Ερμού' },
    });
    expect(email.html).not.toMatch(/<b>|<img/);
    expect(email.html).toContain(
      '«<span lang="en">&lt;b&gt;<span lang="el">Γκαράζ</span>&lt;/b&gt; &amp; &quot;Co&quot;</span>»',
    );
    expect(email.html).toContain('&lt;img src=x&gt; <span lang="el">Ερμού</span>');
  });
});

describe('cancellations in Greek', () => {
  it('tell the driver who called it off and what comes back', () => {
    const byOwner = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-cancelled',
      listingName: 'Γκαράζ',
      booking: { ...booking, refundMinor: 1250, cancelledBy: 'owner' },
    });
    expect(byOwner.text).toContain('Ο ιδιοκτήτης ακύρωσε την κράτησή σας');
    expect(byOwner.text).toContain('Επιστροφή χρημάτων: 12,50');
    const byDriver = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-cancelled',
      listingName: 'Γκαράζ',
      booking: { ...booking, refundMinor: 0, cancelledBy: 'driver' },
    });
    expect(byDriver.text).toContain('Ακυρώσατε την κράτησή σας');
    expect(byDriver.text).toContain('Επιστροφή χρημάτων: 0,00');
  });

  it('tell the owner a booking went, without guessing the driver’s gender', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-cancelled-by-driver',
      listingName: 'Γκαράζ',
    });
    expect(email.subject).toBe('Ακυρώθηκε κράτηση για τον χώρο «Γκαράζ»');
    expect(email.text).toContain('Ακυρώθηκε μια κράτηση');
    expect(email.text).not.toContain('κράτησή του');
  });
});

describe('copy', () => {
  it('uses Greek in the Greek copy and none in the English', () => {
    const greek = /\p{Script=Greek}/u;
    for (const copy of Object.values(BOOKING_EMAIL_COPY.el.kinds)) {
      expect(copy.subject('K7M4-Q2ZD', 'x') + copy.heading + copy.body('x')).toMatch(greek);
    }
    for (const copy of Object.values(BOOKING_EMAIL_COPY.en.kinds)) {
      expect(
        copy.subject('K7M4-Q2ZD', 'x') + copy.heading + copy.body('x') + copy.note,
      ).not.toMatch(greek);
    }
  });
});
