/**
 * The audit log (#68): what staff did, written in the action's own transaction and never changed.
 * The database refuses an update, a delete or a truncate (migration 0036), so even a flaw in the
 * API can't rewrite history. Ids and short words only: no document, tax value or address.
 */
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export type AuditDetails = Record<string, string | number | boolean | null>;

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
    /** Who did it. Restricted: an account that acted is never deleted out from under its record. */
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').$type<(typeof AUDIT_ACTIONS)[number]>().notNull(),
    targetType: text('target_type').$type<(typeof AUDIT_TARGETS)[number]>().notNull(),
    /** What it was done to; not a foreign key, since the log outlives whatever it names. */
    targetId: uuid('target_id').notNull(),
    details: jsonb('details').$type<AuditDetails>().notNull().default({}),
  },
  (t) => [
    // The log, newest first, a page at a time by place.
    index('audit_log_at_idx').on(t.at.desc(), t.id.desc()),
    // One action, newest first.
    index('audit_log_action_at_idx').on(t.action, t.at.desc(), t.id.desc()),
    // Everything done to one thing, and (with the restrict) what an account did.
    index('audit_log_target_idx').on(t.targetType, t.targetId, t.at.desc()),
    index('audit_log_actor_idx').on(t.actorId, t.at.desc()),
    check('audit_log_action_check', sql`${t.action} in (${sqlList(AUDIT_ACTIONS)})`),
    check('audit_log_target_type_check', sql`${t.targetType} in (${sqlList(AUDIT_TARGETS)})`),
    check('audit_log_details_check', sql`jsonb_typeof(${t.details}) = 'object'`),
  ],
);
