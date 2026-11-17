import { randomInt } from 'node:crypto';

import { Client } from 'pg';

/** The database of a local or CI run; a deployed target's is out of the suite's reach. */
const DATABASE_URL = process.env.SMOKE_WEB_URL
  ? undefined
  : (process.env.DATABASE_URL ?? 'postgres://parkfairy:parkfairy@localhost:5434/parkfairy');

export const HAS_DATABASE = Boolean(DATABASE_URL);

async function run<Row extends object = object>(sql: string, values: unknown[]): Promise<Row[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<Row>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

/** A booking's dispute (4.3), as Stripe's webhook recorded it; none yet, null. */
export async function disputeOf(
  bookingId: string,
): Promise<{ status: string; evidenceStaged: boolean } | null> {
  const [row] = await run<{ status: string; evidence_staged_at: string | null }>(
    `select status, evidence_staged_at from payment_disputes where booking_id = $1`,
    [bookingId],
  );
  return row ? { status: row.status, evidenceStaged: row.evidence_staged_at !== null } : null;
}

/** A cancelled booking's refund at Stripe (4.2), and what its ledger has: kinds and amounts. */
export async function refundOf(
  bookingId: string,
): Promise<{ refundStatus: string | null; ledger: Record<string, number> }> {
  const [booking] = await run<{ refund_status: string | null }>(
    `select refund_status from bookings where id = $1`,
    [bookingId],
  );
  const entries = await run<{ kind: string; amount_minor: number }>(
    `select kind, amount_minor from ledger_entries where booking_id = $1`,
    [bookingId],
  );
  return {
    refundStatus: booking?.refund_status ?? null,
    ledger: Object.fromEntries(entries.map((entry) => [entry.kind, entry.amount_minor])),
  };
}

/** Makes an account platform staff, which no screen does: by hand, as in GETTING_STARTED.md. */
export async function makeStaff(email: string): Promise<void> {
  await run(`update users set role = 'admin' where email = $1`, [email]);
}

/** What staff did by hand before the staff app (5.2b), for tests that need a state it skips. */
export async function sendListingBack(id: string, note: string): Promise<void> {
  await run(
    `update parking_locations set status = 'changes_requested', review_note = $2 where id = $1`,
    [id, note],
  );
}

/** Staff approving a listing, by hand as above. */
export async function publishListing(id: string): Promise<void> {
  await run(`update parking_locations set status = 'published' where id = $1`, [id]);
}

/** Takes a smoke listing back out of the public catalogue, so a later run never meets it. */
export async function unpublishListing(id: string): Promise<void> {
  await run(`update parking_locations set status = 'draft', slug = 'draft-' || id where id = $1`, [
    id,
  ]);
}

const REFERENCE_LETTERS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () => {
  const four = () =>
    Array.from({ length: 4 }, () => REFERENCE_LETTERS[randomInt(REFERENCE_LETTERS.length)]).join(
      '',
    );
  return `${four()}-${four()}`;
};

/**
 * A busy listing for the owner's pages: `count` confirmed bookings on its first space, an hour
 * each, two hours apart from tomorrow, booked by the owner's own account (the API refuses that,
 * which is why they go straight in). They are left behind: the listing goes back to a draft after
 * the test, and the stays pass.
 */
/**
 * The listing's owner can be paid: an Express account marked active, as Stripe's webhook would
 * (decision #48). Only for a run with Stripe's test keys, where a real onboarding can't be done.
 */
export async function activatePayouts(listingId: string): Promise<void> {
  await run(
    `insert into payout_accounts (owner_id, stripe_account_id, status)
     select owner_id, 'acct_smoke' || substr(md5(random()::text), 1, 12), 'active'
     from parking_locations where id = $1
     on conflict (owner_id) do update set status = 'active'`,
    [listingId],
  );
}

/**
 * The account with this address can be paid: an active Express account, as Stripe's webhook would
 * leave it. For a co-owner, who must have one to take over a listing's primary role (#63); the
 * account needs its owner profile (accepting an invitation makes one).
 */
export async function activatePayoutsOf(email: string): Promise<void> {
  const made = await run(
    `insert into payout_accounts (owner_id, stripe_account_id, status)
     select p.id, 'acct_smoke' || substr(md5(random()::text), 1, 12), 'active'
     from owner_profiles p join users u on u.id = p.user_id
     where u.email = $1
     on conflict (owner_id) do update set status = 'active'
     returning owner_id`,
    [email.toLowerCase()],
  );
  if (made.length !== 1) throw new Error('No owner profile for that address');
}

export async function addBookings(listingId: string, count: number): Promise<void> {
  await run(
    `insert into bookings (reference, user_id, location_id, space_id, space_label, listing_name,
       listing_address, listing_locale, starts_at, ends_at, gap_minutes, blocked_until, status,
       hold_expires_at, total_minor, currency, cancellation_policy, vehicle_plate, confirmed_at,
       commission_bps)
     select r.reference, p.user_id, l.id, s.id, s.label, l.name, l.address, l.content_locale,
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours',
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours' + interval '1 hour',
       0,
       date_trunc('hour', now()) + interval '1 day' + r.n * interval '2 hours' + interval '1 hour',
       'confirmed', now(), 400, 'EUR', 'oneDay', 'IKB1234', now(),
       (select commission_bps from platform_settings)
     from unnest($2::text[]) with ordinality as r(reference, n)
     join parking_locations l on l.id = $1
     join owner_profiles p on p.id = l.owner_id
     join lateral (
       select id, label from parking_spaces where location_id = l.id order by label limit 1
     ) s on true`,
    [listingId, Array.from({ length: count }, reference)],
  );
}

/**
 * What an owner has been paid for a listing (5.1), as the worker would have left it: `sent`
 * parts already transferred (each from a stay that ended four days ago), `sending` parts worked
 * out and not sent, and `coming` paid bookings whose stay hasn't ended. The owner is the
 * listing's, who also books them (the API refuses that, which is why they go straight in).
 */
export async function addEarnings(
  listingId: string,
  {
    sent = [],
    sending = [],
    coming = 0,
    due = 0,
  }: { sent?: number[]; sending?: number[]; coming?: number; due?: number },
): Promise<void> {
  const parts: { minor: number | null; status: 'sent' | 'sending' | null; endsInHours: number }[] =
    [
      ...sent.map((minor) => ({ minor, status: 'sent' as const, endsInHours: -96 })),
      ...sending.map((minor) => ({ minor, status: 'sending' as const, endsInHours: -96 })),
      // Over a day ago and not worked out: what a restricted account holds back (#52).
      ...Array.from({ length: due }, () => ({ minor: null, status: null, endsInHours: -72 })),
      ...Array.from({ length: coming }, () => ({
        minor: null,
        status: null,
        endsInHours: 48,
      })),
    ];
  for (const part of parts) {
    const [booking] = await run<{ id: string }>(
      `insert into bookings (reference, user_id, location_id, space_label, listing_name,
         listing_address, listing_locale, starts_at, ends_at, gap_minutes, blocked_until, status,
         hold_expires_at, total_minor, currency, cancellation_policy, vehicle_plate, confirmed_at,
         commission_bps, payment_intent_id, payment_status, stripe_charge_id)
       select $2, p.user_id, l.id, 'A1', l.name, l.address, l.content_locale,
         now() + $3 * interval '1 hour' - interval '2 hours', now() + $3 * interval '1 hour', 0,
         now() + $3 * interval '1 hour', 'confirmed', now(), 400, 'EUR', 'oneDay', 'IKB1234', now(),
         1000, 'pi_smoke' || substr(md5(random()::text), 1, 20), 'succeeded',
         'ch_smoke' || substr(md5(random()::text), 1, 20)
       from parking_locations l join owner_profiles p on p.id = l.owner_id
       where l.id = $1
       returning id`,
      [listingId, reference(), part.endsInHours],
    );
    if (!booking) throw new Error('No such listing');
    await run(
      `insert into booking_payees (booking_id, owner_id, share_bps, transfer_minor, transfer_status,
         stripe_transfer_id, transferred_at)
       select $1, l.owner_id, 10000, $2::int, $3::text,
         case when $3::text = 'sent' and $2::int > 0 then 'tr_smoke' || substr(md5(random()::text), 1, 20) end,
         case when $3::text = 'sent' then now() - interval '3 days' end
       from parking_locations l where l.id = $4`,
      [booking.id, part.minor, part.status, listingId],
    );
  }
}

/**
 * A listing's history, for the owner's list of bookings (5.1): `past` confirmed stays that ended
 * between a day and `past` days ago, one a day, and `cancelled` stays called off (by the driver,
 * one of them still to come). The listing's owners are made to have joined 60 days ago: they see
 * no stay that ended before they joined, and a listing made a moment ago has none older.
 */
export async function addBookingHistory(
  listingId: string,
  { past = 0, cancelled = 0 }: { past?: number; cancelled?: number },
): Promise<void> {
  await run(
    `update listing_owners set created_at = now() - interval '60 days' where location_id = $1`,
    [listingId],
  );
  const stays = [
    ...Array.from({ length: past }, (_, index) => ({ days: -(index + 1), status: 'confirmed' })),
    ...Array.from({ length: cancelled }, (_, index) => ({
      // The first still to come, the rest over.
      days: index === 0 ? 3 : -(index + 1),
      status: 'cancelled',
    })),
  ];
  for (const stay of stays) {
    await run(
      `insert into bookings (reference, user_id, location_id, space_label, listing_name,
         listing_address, listing_locale, starts_at, ends_at, gap_minutes, blocked_until, status,
         hold_expires_at, total_minor, currency, cancellation_policy, vehicle_plate, confirmed_at,
         commission_bps, cancelled_at, cancelled_by, refund_minor)
       select $2, p.user_id, l.id, 'A1', l.name, l.address, l.content_locale,
         date_trunc('hour', now()) + $3 * interval '1 day',
         date_trunc('hour', now()) + $3 * interval '1 day' + interval '2 hours', 0,
         date_trunc('hour', now()) + $3 * interval '1 day' + interval '2 hours',
         $4::text, now(), 400, 'EUR', 'oneDay', 'IKB1234', now(),
         (select commission_bps from platform_settings),
         case when $4::text = 'cancelled' then now() end,
         case when $4::text = 'cancelled' then 'driver' end,
         case when $4::text = 'cancelled' then 400 end
       from parking_locations l join owner_profiles p on p.id = l.owner_id
       where l.id = $1`,
      [listingId, reference(), stay.days, stay.status],
    );
  }
}

/** A listing's bookings, soonest first, as `addBookings` made them: the id and the reference to quote. */
export async function bookingsOf(listingId: string): Promise<{ id: string; reference: string }[]> {
  return run<{ id: string; reference: string }>(
    `select id, reference from bookings where location_id = $1 order by starts_at, id`,
    [listingId],
  );
}

/**
 * A booking whose refund Stripe took and then failed (4.2): paid, cancelled, its refund `failed`
 * with Stripe's id. As it stands after a closed card; support settles it (5.2c3, #84).
 */
export async function failRefund(bookingId: string): Promise<void> {
  await run(
    `update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'driver',
       refund_minor = total_minor, payment_intent_id = coalesce(payment_intent_id, 'pi_smoke' || substr(md5(random()::text), 1, 12)),
       payment_status = 'succeeded', refund_status = 'failed',
       stripe_refund_id = 're_smoke' || substr(md5(random()::text), 1, 12)
     where id = $1`,
    [bookingId],
  );
}

/** A booking paid for, as Stripe's charge would leave it, with the listing's owner as its payee. */
export async function makePaid(bookingId: string): Promise<void> {
  await run(
    `update bookings set payment_intent_id = coalesce(payment_intent_id, 'pi_smoke' || substr(md5(random()::text), 1, 12)),
       payment_status = 'succeeded' where id = $1`,
    [bookingId],
  );
  await run(
    `insert into booking_payees (booking_id, owner_id, share_bps)
     select b.id, l.owner_id, 10000 from bookings b join parking_locations l on l.id = b.location_id
     where b.id = $1 on conflict do nothing`,
    [bookingId],
  );
}

/** A dispute the bank decided for the driver, as the webhook would record it; nobody has decided yet. */
export async function loseDispute(bookingId: string): Promise<string> {
  await makePaid(bookingId);
  const [row] = await run<{ id: string }>(
    `insert into payment_disputes (booking_id, stripe_dispute_id, status, reason, amount_minor, currency)
     values ($1, 'dp_smoke' || substr(md5(random()::text), 1, 12), 'lost', 'fraudulent', 400, 'EUR')
     returning id`,
    [bookingId],
  );
  return row?.id ?? '';
}

/** What staff's actions left on a booking: its refund, its attempts, and who bears a lost dispute. */
export async function moneyOf(bookingId: string): Promise<{
  status: string;
  refundStatus: string | null;
  attempts: number;
  decision: string | null;
}> {
  const [row] = await run<{
    status: string;
    refund_status: string | null;
    refund_attempts: number;
    decision: string | null;
  }>(
    `select b.status, b.refund_status, b.refund_attempts,
       (select d.decision from payment_disputes d where d.booking_id = b.id limit 1) as decision
     from bookings b where b.id = $1`,
    [bookingId],
  );
  return {
    status: row?.status ?? '',
    refundStatus: row?.refund_status ?? null,
    attempts: Number(row?.refund_attempts ?? 0),
    decision: row?.decision ?? null,
  };
}

/**
 * Stays that ended `hoursAgo` hours ago on a listing, as the listing's owner's own bookings (the API
 * refuses that, so they go in by hand), and the owner's place on the listing moved back a month: an
 * owner reads only the stays that ended after they joined it (#35), and a smoke listing is minutes
 * old. Returns each booking's id and reference, oldest first.
 */
export async function addEndedBookings(
  listingId: string,
  count: number,
  hoursAgo = 3,
): Promise<{ id: string; reference: string }[]> {
  await run(
    `update listing_owners set created_at = now() - interval '30 days' where location_id = $1`,
    [listingId],
  );
  return run<{ id: string; reference: string }>(
    `insert into bookings (reference, user_id, location_id, space_id, space_label, listing_name,
       listing_address, listing_locale, starts_at, ends_at, gap_minutes, blocked_until, status,
       hold_expires_at, total_minor, currency, cancellation_policy, vehicle_plate, confirmed_at,
       commission_bps)
     select r.reference, p.user_id, l.id, s.id, s.label, l.name, l.address, l.content_locale,
       now() - ($3::int + 3 * ($4::int - r.n::int) + 1) * interval '1 hour',
       now() - ($3::int + 3 * ($4::int - r.n::int)) * interval '1 hour',
       0,
       now() - ($3::int + 3 * ($4::int - r.n::int)) * interval '1 hour',
       'confirmed', now() - interval '2 days', 400, 'EUR', 'oneDay', 'IKB1234', now() - interval '2 days',
       (select commission_bps from platform_settings)
     from unnest($2::text[]) with ordinality as r(reference, n)
     join parking_locations l on l.id = $1
     join owner_profiles p on p.id = l.owner_id
     join lateral (
       select id, label from parking_spaces where location_id = l.id order by label limit 1
     ) s on true
     returning id, reference`,
    [listingId, Array.from({ length: count }, reference), hoursAgo, count],
  );
}

/** A booking's overstay report as the database has it: none yet, null. */
export async function overstayOf(bookingId: string): Promise<{
  status: string;
  note: string;
  resolution: string | null;
} | null> {
  const [row] = await run<{ status: string; note: string; resolution: string | null }>(
    `select status, note, resolution from overstay_reports where booking_id = $1`,
    [bookingId],
  );
  return row ?? null;
}
