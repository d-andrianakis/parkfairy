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
