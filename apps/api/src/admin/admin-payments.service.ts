import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADMIN_PAYMENTS_LIST_MAX,
  AdminPaymentsSchema,
  type AdminDisputeDecisionInput,
  type AdminPaymentItem,
  type AdminPayments,
} from '@parkfairy/contracts';
import { recordAudit, schema, type Database } from '@parkfairy/database';
import { and, eq, sql } from 'drizzle-orm';
import { BookingsService } from '../bookings/bookings.service.js';
import { DB } from '../database/database.module.js';

const dispute = schema.paymentDisputes;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refused(status: 404 | 409, code: string) {
  const body = { statusCode: status, message: code, code };
  return status === 404
    ? new NotFoundException({ ...body, error: 'Not Found' })
    : new ConflictException({ ...body, error: 'Conflict' });
}

type Row = {
  booking_id: string;
  reference: string;
  listing_name: string | null;
  listing_locale: 'el' | 'en';
  amount_minor: number;
  currency: string;
  dispute_id: string | null;
  dispute_status: AdminPaymentItem['disputeStatus'];
  reason: string | null;
  due_by: string | null;
  attempts: number;
  at: string;
};

const item = (row: Row): AdminPaymentItem => ({
  bookingId: row.booking_id,
  reference: row.reference,
  listingName: row.listing_name,
  contentLocale: row.listing_locale,
  amount: { amountMinor: Number(row.amount_minor), currency: row.currency as 'EUR' },
  disputeId: row.dispute_id,
  disputeStatus: row.dispute_status,
  reason: row.reason,
  dueBy: row.due_by ? new Date(row.due_by).toISOString() : null,
  attempts: Number(row.attempts),
  at: new Date(row.at).toISOString(),
});

/**
 * What needs support in money (5.2c3): lost disputes that hold a payout until staff say who bears
 * them (#57, #83), disputes still open at the bank, and refunds that failed after Stripe took them
 * (#84). Deciding a dispute is a line of the audit log, in its own transaction.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingsService,
  ) {}

  async list(): Promise<AdminPayments> {
    const limit = ADMIN_PAYMENTS_LIST_MAX + 1;
    // A few at a time: the API's pool is small, and a page of staff is not worth three connections.
    const lost = await this.db.execute<Row>(sql`
      select b.id as booking_id, b.reference, b.listing_name, b.listing_locale, d.amount_minor,
        d.currency, d.id as dispute_id, d.status as dispute_status, d.reason,
        d.due_by::text as due_by, 0 as attempts, d.updated_at::text as at
      from payment_disputes d join bookings b on b.id = d.booking_id
      where d.status = 'lost' and d.decision is null
      order by d.updated_at, d.id
      limit ${limit}
    `);
    const open = await this.db.execute<Row>(sql`
      select b.id as booking_id, b.reference, b.listing_name, b.listing_locale, d.amount_minor,
        d.currency, d.id as dispute_id, d.status as dispute_status, d.reason,
        d.due_by::text as due_by, 0 as attempts, d.updated_at::text as at
      from payment_disputes d join bookings b on b.id = d.booking_id
      where d.status in ('needs_response', 'warning_needs_response', 'under_review', 'warning_under_review')
      order by d.due_by nulls last, d.id
      limit ${limit}
    `);
    const failed = await this.db.execute<Row>(sql`
      select b.id as booking_id, b.reference, b.listing_name, b.listing_locale,
        b.refund_minor as amount_minor, b.currency, null as dispute_id, null as dispute_status,
        null as reason, null as due_by, b.refund_attempts as attempts, b.updated_at::text as at
      from bookings b
      where b.refund_status = 'failed' or (b.refund_status = 'owed' and b.refund_attempts > 0)
      order by b.updated_at, b.id
      limit ${limit}
    `);
    const page = (rows: { rows: Row[] }) => rows.rows.slice(0, ADMIN_PAYMENTS_LIST_MAX).map(item);
    return AdminPaymentsSchema.parse({
      lostDisputes: page(lost),
      openDisputes: page(open),
      failedRefunds: page(failed),
      more: {
        lostDisputes: lost.rows.length > ADMIN_PAYMENTS_LIST_MAX,
        openDisputes: open.rows.length > ADMIN_PAYMENTS_LIST_MAX,
        failedRefunds: failed.rows.length > ADMIN_PAYMENTS_LIST_MAX,
      },
    });
  }

  /**
   * Who bears a lost dispute (#57, #83), once: Parkfairy, so the owners' payout is released as
   * normal, or the owners, so it never goes. The booking's row is locked first, as the dispute is
   * recorded and a transfer is marked (a payout is never started under a decision half made); then
   * the dispute's. Each owner paid for the booking is told.
   */
  async decide(
    adminId: string,
    id: string,
    { decision, note }: AdminDisputeDecisionInput,
  ): Promise<{ bookingId: string }> {
    if (!UUID.test(id)) throw refused(404, 'DISPUTE_NOT_FOUND');
    return this.db.transaction(async (tx) => {
      const [located] = await tx
        .select({ bookingId: dispute.bookingId })
        .from(dispute)
        .where(eq(dispute.id, id));
      if (!located) throw refused(404, 'DISPUTE_NOT_FOUND');
      await tx.execute(sql`select 1 from bookings where id = ${located.bookingId} for update`);
      const [row] = await tx
        .select({ status: dispute.status, decision: dispute.decision })
        .from(dispute)
        .where(eq(dispute.id, id))
        .for('update');
      if (!row) throw refused(404, 'DISPUTE_NOT_FOUND');
      if (row.status !== 'lost') throw refused(409, 'NOT_LOST');
      if (row.decision !== null) throw refused(409, 'ALREADY_DECIDED');
      // Whether a payout is still to come: not once it was sent, nor when all was refunded. Then
      // nobody can be made to bear the loss through it, so only Parkfairy's bearing it is recorded,
      // and the owners, who lose and gain nothing, are not told.
      const [paid] = await tx
        .select({
          transferStatus: schema.bookings.transferStatus,
          refundMinor: schema.bookings.refundMinor,
          totalMinor: schema.bookings.totalMinor,
        })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, located.bookingId));
      const payoutHeld =
        paid?.transferStatus !== 'sent' &&
        (paid?.refundMinor === null ||
          paid?.refundMinor === undefined ||
          paid.refundMinor < paid.totalMinor);
      if (!payoutHeld && decision === 'owners_bear') throw refused(409, 'NOT_HELD');
      const [decided] = await tx
        .update(dispute)
        .set({ decision, decidedBy: adminId, decidedAt: new Date() })
        .where(and(eq(dispute.id, id), eq(dispute.status, 'lost')))
        .returning({ amountMinor: dispute.amountMinor, currency: dispute.currency });
      if (payoutHeld) {
        await this.bookings.tellPayees(
          tx,
          located.bookingId,
          decision === 'parkfairy_bears' ? 'dispute-parkfairy-bears' : 'dispute-owners-bear',
        );
      }
      await recordAudit(tx, {
        actorId: adminId,
        action: 'dispute.decided',
        targetType: 'dispute',
        targetId: id,
        details: {
          bookingId: located.bookingId,
          decision,
          amountMinor: decided?.amountMinor ?? null,
          note,
        },
      });
      return { bookingId: located.bookingId };
    });
  }
}
