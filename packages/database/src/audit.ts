import type { AuditAction } from '@parkfairy/contracts';

import type { Database } from './client.js';
import { type AuditDetails, auditLog } from './schema/audit.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Writes one line of the audit log (#68). Always inside the transaction of what it records, so a
 * change and its record stand or fall together: an action that rolled back leaves no line, and one
 * that went through always has one.
 */
export async function recordAudit(
  tx: Transaction,
  entry: {
    actorId: string;
    action: AuditAction;
    targetType: 'listing' | 'user' | 'booking' | 'dispute';
    targetId: string;
    details?: AuditDetails;
  },
): Promise<void> {
  // The time from here, to the millisecond: a page of the log names its place exactly.
  await tx.insert(auditLog).values({ details: {}, at: new Date(), ...entry });
}
