import { describe, expect, it } from 'vitest';

import {
  BOOKING_EMAIL_COPY,
  BOOKING_EMAIL_KINDS,
  type BookingEmailFacts,
  renderBookingEmail,
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
/** A fact's cell, its inline style left out: `lang` (or none) and what it holds. */
const cell = (html: string, content: string) =>
  [...html.matchAll(/<td( lang="[a-z]+")? style="[^"]*">(.*?)<\/td>/g)]
    .filter(([, , inner]) => inner === content)
    .map(([, lang]) => lang?.trim() ?? '');

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
      kind === 'booking-cancelled-by-team'
        ? `/${locale}/owner/listings/${booking.listingId}/owners`
        : kind === 'dispute-owners-bear'
          ? `/${locale}/owner/earnings`
          : kind.startsWith('booking-cancelled-by') ||
              kind === 'booking-received' ||
              kind === 'dispute-parkfairy-bears'
            ? `/${locale}/owner/listings/${booking.listingId}/bookings`
            : // The reminder before a stay opens its pass (5A.3).
              `/${locale}/bookings/${booking.id}${kind === 'booking-starting-soon' ? '/pass' : ''}`;
    expect(email.text).toContain(`https://parkfairy.example${path}`);
    expect(email.html).toContain(`href="https://parkfairy.example${path}"`);
  });

  it('tells owners support called a booking off, the driver refunded, and that no share comes of it', () => {
    const en = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-cancelled-by-staff',
      listingName: 'Ermou Garage',
    });
    expect(en.subject).toBe('Support cancelled a booking for “Ermou Garage”');
    expect(en.text).toContain('refunded in full');
    expect(en.text).toContain('You won’t receive a share of this booking');
    const el = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-cancelled-by-staff',
      listingName: 'Γκαράζ Ερμού',
    });
    expect(el.text).toContain('Η υποστήριξη του Parkfairy ακύρωσε μια κράτηση');
    expect(el.text).toContain('Δεν θα λάβετε μερίδιο');
  });

  it('tells owners who bears a lost dispute: the payout goes on, or it never goes, in both languages', () => {
    const goes = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'dispute-parkfairy-bears',
      listingName: 'Ermou Garage',
    });
    expect(goes.subject).toContain('K7M4-Q2ZD');
    expect(goes.subject).toContain('will be sent as usual');
    expect(goes.text).toContain('Parkfairy bears the cost');
    const stays = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'dispute-owners-bear',
      listingName: 'Ermou Garage',
    });
    expect(stays.subject).toContain('will not be sent');
    expect(stays.text).toContain('your share of this booking will not be sent');
    const el = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'dispute-owners-bear',
      listingName: 'Γκαράζ Ερμού',
    });
    expect(el.text).toContain('δεν θα σταλεί');
    expect(
      renderBookingEmail({
        ...base,
        locale: 'el',
        kind: 'dispute-parkfairy-bears',
        listingName: 'Γκαράζ Ερμού',
      }).text,
    ).toContain('το αναλαμβάνει το Parkfairy');
  });

  it('carries no driver in the dispute emails: the booking, never the person or the plate', () => {
    for (const kind of [
      'dispute-parkfairy-bears',
      'dispute-owners-bear',
      'booking-cancelled-by-staff',
    ] as const) {
      const { text } = renderBookingEmail({
        ...base,
        locale: 'en',
        kind,
        listingName: 'Ermou Garage',
      });
      expect(text).not.toMatch(/IKB|@example/);
    }
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
    expect(cell(email.html, 'Γκαράζ Ερμού')).toEqual(['lang="el"']);
    expect(cell(email.html, 'Ερμού 1, Αθήνα')).toEqual(['lang="el"']);
    // Our own words aren't the owner's.
    expect(cell(email.html, 'K7M4-Q2ZD')).toEqual(['']);
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
    expect(cell(english.html, 'Ermou 1, <span lang="el">Σύνταγμα</span>, Athens')).toEqual([
      'lang="en"',
    ]);
    // A Greek alpha in a space's label too.
    expect(cell(english.html, '<span lang="el">Α1</span>')).toEqual(['lang="en"']);
    // The name is the email's language already: only its Greek words are marked.
    expect(english.html).toContain(
      'A driver has booked a space at “Garage by <span lang="el">Πλατεία Συντάγματος</span>”.',
    );
    expect(english.text).toContain('Address: Ermou 1, Σύνταγμα, Athens');

    // In Greek the name is English, its Greek words marked inside it.
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
    expect(cell(greek.html, 'Ermou 1, <span lang="el">Σύνταγμα</span>, Athens')).toEqual([
      'lang="en"',
    ]);
  });

  it('leave a Greek listing alone in a Greek email', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-confirmed',
      listingName: 'Γκαράζ Ερμού',
      booking: { ...booking, contentLocale: 'el' },
    });
    expect(email.html).not.toMatch(/<span lang/);
  });

  it('leave a listing with no name, and our own facts, in the email’s language', () => {
    const email = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-confirmed',
      booking: { ...booking, contentLocale: 'el' },
    });
    expect(email.html).toContain('Your space at “Unnamed parking” is booked.');
    expect(cell(email.html, 'Unnamed parking')).toEqual(['']);
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
    // Where it goes, and how long it takes (4.2: refunded at Stripe as it is cancelled).
    expect(byOwner.text).toContain('επιστρέφονται στην κάρτα με την οποία πληρώσατε');
    const byDriver = renderBookingEmail({
      ...base,
      locale: 'el',
      kind: 'booking-cancelled',
      listingName: 'Γκαράζ',
      booking: { ...booking, refundMinor: 0, cancelledBy: 'driver' },
    });
    expect(byDriver.text).toContain('Ακυρώσατε την κράτησή σας');
    expect(byDriver.text).toContain('Επιστροφή χρημάτων: 0,00');
    expect(byDriver.text).toContain('Τυχόν επιστροφή χρημάτων γίνεται στην κάρτα');
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

describe('the primary owner’s email about a cancellation by their team (#69)', () => {
  const team = (
    role: 'manager' | 'co_owner',
    locale: 'en' | 'el',
    extra: Partial<BookingEmailFacts> = {},
  ) =>
    renderBookingEmail({
      ...base,
      booking: { ...booking, cancelledBy: 'owner', cancelledByRole: role, ...extra },
      locale,
      kind: 'booking-cancelled-by-team',
      listingName: 'Γκαράζ Ερμού',
    });

  it('says by role who it was, and that the driver was told and refunded', () => {
    expect(team('manager', 'en').subject).toBe('A manager cancelled a booking for “Γκαράζ Ερμού”');
    expect(team('manager', 'en').text).toContain('A manager of “Γκαράζ Ερμού” cancelled a booking');
    expect(team('manager', 'en').text).toContain('refunded in full');
    expect(team('co_owner', 'en').subject).toBe(
      'A co-owner cancelled a booking for “Γκαράζ Ερμού”',
    );
    expect(team('manager', 'el').text).toContain('Ένας διαχειριστής του χώρου «Γκαράζ Ερμού»');
    expect(team('co_owner', 'el').text).toContain('Ένας συνιδιοκτήτης του χώρου «Γκαράζ Ερμού»');
  });

  it('is the co-owner’s wording when no role is given, and leads to where the team is listed', () => {
    const plain = renderBookingEmail({
      ...base,
      locale: 'en',
      kind: 'booking-cancelled-by-team',
    });
    expect(plain.text).toContain('A co-owner of');
    expect(plain.text).toContain(`/en/owner/listings/${booking.listingId}/owners`);
    expect(team('manager', 'en').text).toContain('remove the manager from there');
  });

  it('names no one: not the manager, not the driver, not their plate', () => {
    for (const locale of ['en', 'el'] as const) {
      const sent = team('manager', locale);
      expect(sent.text).not.toMatch(/IKB|Test Driver|@/);
    }
  });
});
