import { DISPUTES_SETTLED, type DisputeStatus } from '@parkfairy/contracts';
import { eq, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { paymentDisputes } from './schema/payments.js';

/**
 * Disputes of a booking's payment (4.3, #57–#60), as the API records what Stripe says and the
 * worker's daily look reads them. Holding the payout lives in `money.ts`, with the transfer.
 */

export interface DisputeRecord {
  stripeDisputeId: string;
  status: DisputeStatus;
  reason: string;
  amountMinor: number;
  currency: string;
  dueBy: Date | null;
  submissions: number;
}

/**
 * A dispute as Stripe has it now, recorded against its booking: new, or brought up to date. Says
 * whether it is new, and whether its evidence was staged already (#59); null when this reading is
 * older than the one recorded (a settled dispute read as open, by a delivery that crossed a later
 * one): it changes nothing.
 *
 * The booking's row is locked first, as the transfer sweep's update takes it: a dispute recorded
 * here and a transfer marked as sending there happen one after the other, never both unseen.
 */
export async function recordDispute(
  db: Database,
  bookingId: string,
  dispute: DisputeRecord,
): Promise<{ opened: boolean; evidenceStaged: boolean } | null> {
  const settled = sql.join(
    DISPUTES_SETTLED.map((status) => sql`${status}`),
    sql`, `,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from bookings where id = ${bookingId} for update`);
    const rows = await tx.execute<{ opened: boolean; evidence_staged_at: string | null }>(sql`
      insert into ${paymentDisputes}
        (booking_id, stripe_dispute_id, status, reason, amount_minor, currency, due_by, submissions)
      values (${bookingId}, ${dispute.stripeDisputeId}, ${dispute.status}, ${dispute.reason},
        ${dispute.amountMinor}, ${dispute.currency},
        ${dispute.dueBy ? dispute.dueBy.toISOString() : null}::timestamptz, ${dispute.submissions})
      on conflict (stripe_dispute_id) do update set
        status = excluded.status, reason = excluded.reason, amount_minor = excluded.amount_minor,
        due_by = excluded.due_by, submissions = excluded.submissions, updated_at = now()
      where (${paymentDisputes.status} not in (${settled}) or excluded.status in (${settled}))
        -- Decided by staff (#83): Stripe's later word changes nothing, and can't break the decision's check.
        and ${paymentDisputes.decision} is null
      returning (xmax = 0) as opened, evidence_staged_at
    `);
    const [row] = rows.rows;
    if (!row) return null;
    return { opened: row.opened === true, evidenceStaged: Boolean(row.evidence_staged_at) };
  });
}

/** The booking's evidence is staged at Stripe: not again. */
export async function markEvidenceStaged(db: Database, stripeDisputeId: string): Promise<void> {
  await db
    .update(paymentDisputes)
    .set({ evidenceStagedAt: new Date() })
    .where(eq(paymentDisputes.stripeDisputeId, stripeDisputeId));
}

/**
 * Disputes still to answer whose response is due before `dueBefore`, with nothing sent to the
 * bank yet: past the deadline a dispute is lost, so support must submit (or accept) in time.
 */
export async function disputesToAnswer(db: Database, dueBefore: Date): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from ${paymentDisputes}
    where status in ('needs_response', 'warning_needs_response') and submissions = 0
      and due_by < ${dueBefore.toISOString()}::timestamptz
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

/**
 * Lost disputes whose booking's payout is held (#58), waiting on support to decide who bears the
 * loss (#57): reported every day until they do.
 */
export async function lostDisputesHeld(db: Database): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from ${paymentDisputes} d
    join bookings b on b.id = d.booking_id
    where d.status = 'lost' and d.decision is null and b.transfer_status is distinct from 'sent'
      and b.payment_status = 'succeeded'
  `);
  return Number(rows.rows[0]?.count ?? 0);
}
