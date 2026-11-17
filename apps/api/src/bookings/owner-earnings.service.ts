import { Inject, Injectable } from '@nestjs/common';
import {
  bookingsCursor,
  EARNINGS_PAGE_SIZE,
  type OwnerEarnings,
  type OwnerEarningsQuery,
  OwnerEarningsSchema,
  parseBookingsCursor,
} from '@parkfairy/contracts';
import { type Database, type EarningRow, ownerEarnings, schema } from '@parkfairy/database';
import { eq } from 'drizzle-orm';

import { DB } from '../database/database.module.js';

const profile = schema.ownerProfiles;

const money = (amountMinor: number, currency = 'EUR') => ({ amountMinor, currency });

/**
 * What the signed-in owner has earned (5.1, #50, #51, #54). Whose it is comes from the session
 * alone: the owner's profile is looked up from the user, and every query is on its payee rows, so
 * a co-owner sees their own part of a shared booking and nothing of the others'.
 */
@Injectable()
export class OwnerEarningsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async earnings(userId: string, { after }: OwnerEarningsQuery): Promise<OwnerEarnings> {
    const [owner] = await this.db
      .select({ id: profile.id })
      .from(profile)
      .where(eq(profile.userId, userId));
    const place = after ? parseBookingsCursor(after) : null;
    // Someone who never started as an owner has been paid nothing.
    const rows = owner
      ? await ownerEarnings(
          this.db,
          owner.id,
          new Date(),
          place ? { sentAt: place.start, id: place.id } : undefined,
        )
      : null;
    const shown = rows?.lines.slice(0, EARNINGS_PAGE_SIZE) ?? [];
    const last = shown.at(-1);
    const line = (row: EarningRow) => ({
      id: row.id,
      reference: row.reference,
      listing: { id: row.listingId, name: row.listingName, contentLocale: row.contentLocale },
      end: row.endsAt.toISOString(),
      state: row.state,
      amount: money(row.amountMinor, row.currency),
      sentAt: row.sentAt?.toISOString() ?? null,
      hold: row.hold,
    });
    return OwnerEarningsSchema.parse({
      sent: money(rows?.sentMinor ?? 0),
      sending: money(rows?.sendingMinor ?? 0),
      coming: rows?.coming ?? 0,
      held: rows?.held ?? { account: 0, dispute: 0 },
      months: (rows?.months ?? []).map((month) => ({
        month: month.month,
        amount: money(month.amountMinor),
      })),
      listings: (rows?.listings ?? []).map((row) => ({
        listing: { id: row.id, name: row.name, contentLocale: row.contentLocale },
        amount: money(row.amountMinor),
      })),
      // A first page only: what is on its way is the same on every page.
      inProgress: place ? [] : (rows?.inProgress ?? []).map(line),
      lines: shown.map(line),
      next:
        rows && rows.lines.length > EARNINGS_PAGE_SIZE && last?.sentAt
          ? bookingsCursor({ start: last.sentAt, id: last.id })
          : null,
    });
  }
}
