import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_PAGE_SIZE,
  adminCursor,
  AuditLogSchema,
  parseBookingsCursor,
  type AdminAuditQuery,
  type AuditLog,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

const log = schema.auditLog;
const users = schema.users;

/** The audit log, newest first (#68): read-only here, as the database has it. */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list({ action, after }: AdminAuditQuery): Promise<AuditLog> {
    const place = after ? parseBookingsCursor(after) : null;
    const rows = await this.db
      .select({
        id: log.id,
        at: log.at,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        details: log.details,
        actorId: users.id,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(log)
      .innerJoin(users, eq(users.id, log.actorId))
      .where(
        and(
          action ? eq(log.action, action) : undefined,
          // The place compares as a pair, on the log's time-and-id index.
          place
            ? sql`(${log.at}, ${log.id}) < (${place.start.toISOString()}::timestamptz, ${place.id}::uuid)`
            : undefined,
        ),
      )
      // `nulls last`, as the index declares them: plain `desc` means nulls first, which no index
      // here matches, and the whole log would be sorted for every page (performance review).
      .orderBy(sql`${log.at} desc nulls last`, sql`${log.id} desc nulls last`)
      .limit(ADMIN_PAGE_SIZE + 1);
    const page = rows.slice(0, ADMIN_PAGE_SIZE);
    const last = page.at(-1);
    return AuditLogSchema.parse({
      entries: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        action: row.action,
        actor: { id: row.actorId, name: row.actorName, email: row.actorEmail },
        targetType: row.targetType,
        targetId: row.targetId,
        details: row.details,
      })),
      next: rows.length > ADMIN_PAGE_SIZE && last ? adminCursor(last.at, last.id) : null,
    });
  }
}
