import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminBookingLookupResultSchema,
  AdminBookingSchema,
  type AdminBooking,
  type AdminBookingLookup,
  type AdminBookingLookupResult,
  type AdminReasonInput,
} from '@parkfairy/contracts';
import { DISPUTES_RELEASED } from '@parkfairy/contracts';
import { heldByDispute, recordAudit, schema, type Database } from '@parkfairy/database';
import { asc, eq, sql } from 'drizzle-orm';
import { BookingsService } from '../bookings/bookings.service.js';
import { DB } from '../database/database.module.js';

const booking = schema.bookings;
const users = schema.users;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refused(status: 403 | 404 | 409, code: string) {
  const body = { statusCode: status, message: code, code };
  if (status === 403) return new ForbiddenException({ ...body, error: 'Forbidden' });
  if (status === 404) return new NotFoundException({ ...body, error: 'Not Found' });
  return new ConflictException({ ...body, error: 'Conflict' });
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Support's way into a booking (5.2c3, #82–#85): find it by its reference, see what was booked,
 * paid, refunded and held, call it off with a full refund, and settle a refund that failed. Every
 * change is a line of the audit log in its own transaction; opening a booking is one too, since the
 * driver's name, email and plate are on it.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingsService,
  ) {}

  /** The id behind a reference, or none: what the page then shows is what is logged. */
  async lookup({ reference }: AdminBookingLookup): Promise<AdminBookingLookupResult> {
    const [row] = await this.db
      .select({ id: booking.id })
      .from(booking)
      .where(eq(booking.reference, reference));
    return AdminBookingLookupResultSchema.parse({ id: row?.id ?? null });
  }

  /** A booking's page, and the line in the log that says who opened it. */
  async open(adminId: string, id: string): Promise<AdminBooking> {
    if (!UUID.test(id)) throw refused(404, 'BOOKING_NOT_FOUND');
    const found = await this.read(id);
    await this.db.transaction((tx) =>
      recordAudit(tx, {
        actorId: adminId,
        action: 'booking.viewed',
        targetType: 'booking',
        targetId: id,
        details: { reference: found.reference },
      }),
    );
    return found;
  }

  /**
   * Calls a booking off with a full refund (#82): confirmed and not begun. The driver and every
   * owner are told, the refund is owed and the worker sends it; one transaction with the line of the
   * log, so none without the other.
   */
  async cancel(adminId: string, id: string, { note }: AdminReasonInput): Promise<AdminBooking> {
    if (!UUID.test(id)) throw refused(404, 'BOOKING_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const result = await this.bookings.cancelForStaff(tx, adminId, id);
      if (result === 'not-found') throw refused(404, 'BOOKING_NOT_FOUND');
      if (result === 'not-cancellable') throw refused(409, 'NOT_CANCELLABLE');
      if (result === 'disputed') throw refused(409, 'DISPUTED');
      await recordAudit(tx, {
        actorId: adminId,
        action: 'booking.cancelled',
        targetType: 'booking',
        targetId: id,
        details: { reference: result.reference, refundMinor: result.refundMinor, note },
      });
    });
    return this.read(id);
  }

  /**
   * Asks Stripe again for a refund that failed (#84): back to `owed` with a new attempt, which the
   * worker sends under a key of its own. Only before the owners were paid: past that, what was kept
   * is final and the refund can only be settled by hand.
   */
  async retryRefund(
    adminId: string,
    id: string,
    { note }: AdminReasonInput,
  ): Promise<AdminBooking> {
    await this.changeRefund(id, ['failed'], async (tx, row) => {
      if (row.transferStatus !== null) throw refused(409, 'TRANSFER_MADE');
      // The bank is disputing the charge: asking Stripe to refund it as well can pay the driver twice.
      const held = await tx.execute<{ held: boolean }>(
        sql`select exists (${heldByDispute}) as held from ${booking} b where b.id = ${id}`,
      );
      if (held.rows[0]?.held === true) throw refused(409, 'DISPUTED');
      const [made] = await tx
        .update(booking)
        .set({
          refundStatus: 'owed',
          stripeRefundId: null,
          refundAttempts: sql`${booking.refundAttempts} + 1`,
        })
        .where(eq(booking.id, id))
        .returning({ attempts: booking.refundAttempts, reference: booking.reference });
      await recordAudit(tx, {
        actorId: adminId,
        action: 'booking.refund_retried',
        targetType: 'booking',
        targetId: id,
        details: { reference: made?.reference ?? null, attempt: made?.attempts ?? 0, note },
      });
    });
    return this.read(id);
  }

  /** The driver was paid another way (#84): the failed refund is settled, and stays on record. */
  async settleRefund(
    adminId: string,
    id: string,
    { note }: AdminReasonInput,
  ): Promise<AdminBooking> {
    await this.changeRefund(id, ['failed', 'retried'], async (tx) => {
      const [made] = await tx
        .update(booking)
        .set({ refundStatus: 'settled' })
        .where(eq(booking.id, id))
        .returning({ reference: booking.reference });
      await recordAudit(tx, {
        actorId: adminId,
        action: 'booking.refund_settled',
        targetType: 'booking',
        targetId: id,
        details: { reference: made?.reference ?? null, note },
      });
    });
    return this.read(id);
  }

  /**
   * A refund that failed, under the booking's row lock: one still `failed` (which a second admin
   * won't find), or, for settling, one staff asked again and Stripe keeps refusing (`retried`: owed
   * after an attempt), which nothing else would ever free.
   */
  private async changeRefund(
    id: string,
    states: ('failed' | 'retried')[],
    work: (tx: Transaction, row: { transferStatus: string | null }) => Promise<void>,
  ): Promise<void> {
    if (!UUID.test(id)) throw refused(404, 'BOOKING_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          refundStatus: booking.refundStatus,
          attempts: booking.refundAttempts,
          transferStatus: booking.transferStatus,
        })
        .from(booking)
        .where(eq(booking.id, id))
        .for('update');
      if (!row) throw refused(404, 'BOOKING_NOT_FOUND');
      const state =
        row.refundStatus === 'failed'
          ? 'failed'
          : row.refundStatus === 'owed' && row.attempts > 0
            ? 'retried'
            : null;
      if (!state || !states.includes(state)) throw refused(409, 'REFUND_NOT_FAILED');
      await work(tx, row);
    });
  }

  /** A booking's page without the line in the log: for what a change just did to it. */
  show(id: string): Promise<AdminBooking> {
    return this.read(id);
  }

  private async read(id: string): Promise<AdminBooking> {
    const [row] = await this.db
      .select({
        b: booking,
        driverName: users.name,
        driverEmail: users.email,
      })
      .from(booking)
      .innerJoin(users, eq(users.id, booking.userId))
      .where(eq(booking.id, id));
    if (!row) throw refused(404, 'BOOKING_NOT_FOUND');
    const { b } = row;
    const disputes = await this.db
      .select()
      .from(schema.paymentDisputes)
      .where(eq(schema.paymentDisputes.bookingId, id))
      .orderBy(asc(schema.paymentDisputes.createdAt), asc(schema.paymentDisputes.id));
    const now = new Date();
    // A dispute that holds the payout (open, or lost and undecided or decided against the owners).
    const disputed = disputes.some(
      (dispute) =>
        dispute.decision !== 'parkfairy_bears' &&
        !(DISPUTES_RELEASED as readonly string[]).includes(dispute.status),
    );
    const failed = b.refundStatus === 'failed';
    const retried = b.refundStatus === 'owed' && b.refundAttempts > 0;
    // Nothing kept to pay out: paid already, or all of it refunded.
    const payoutHeld =
      b.transferStatus !== 'sent' && (b.refundMinor === null || b.refundMinor < b.totalMinor);
    return AdminBookingSchema.parse({
      id: b.id,
      reference: b.reference,
      status: b.status,
      listing: {
        id: b.locationId,
        name: b.listingName,
        address: b.listingAddress,
        contentLocale: b.listingLocale,
      },
      spaceLabel: b.spaceLabel,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      driver: { id: b.userId, name: row.driverName, email: row.driverEmail },
      vehiclePlate: b.vehiclePlate,
      total: { amountMinor: b.totalMinor, currency: b.currency },
      paymentStatus: b.paymentStatus,
      refund: {
        status: b.refundStatus,
        amount:
          b.refundMinor === null ? null : { amountMinor: b.refundMinor, currency: b.currency },
        attempts: b.refundAttempts,
      },
      cancelledBy: b.cancelledBy,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      transferStatus: b.transferStatus,
      disputes: disputes.map((dispute) => ({
        id: dispute.id,
        status: dispute.status,
        reason: dispute.reason,
        amount: { amountMinor: dispute.amountMinor, currency: dispute.currency },
        dueBy: dispute.dueBy?.toISOString() ?? null,
        submissions: dispute.submissions,
        decision: dispute.decision,
        decidedAt: dispute.decidedAt?.toISOString() ?? null,
        canDecide: dispute.status === 'lost' && dispute.decision === null,
        payoutHeld,
      })),
      canCancel: b.status === 'confirmed' && b.startsAt > now && !disputed,
      canRetryRefund: failed && b.transferStatus === null && !disputed,
      canSettleRefund: failed || retried,
    });
  }
}
