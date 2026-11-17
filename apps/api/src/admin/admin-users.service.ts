import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AdminReasonInput,
  type AdminRemoveTwoFactorInput,
  type AdminUser,
  type AdminUserLookup,
  type AdminUserLookupResult,
  AdminUserLookupResultSchema,
  AdminUserSchema,
} from '@parkfairy/contracts';
import { type Database, recordAudit, schema } from '@parkfairy/database';
import { and, eq, sql } from 'drizzle-orm';

import { DB } from '../database/database.module.js';

const users = schema.users;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refused(status: 403 | 404 | 409, code: string) {
  const body = { statusCode: status, message: code, code };
  if (status === 403) return new ForbiddenException({ ...body, error: 'Forbidden' });
  if (status === 404) return new NotFoundException({ ...body, error: 'Not Found' });
  return new ConflictException({ ...body, error: 'Conflict' });
}

/** What a page reads of an account: enough to help its person, nothing secret. */
const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  locale: users.locale,
  emailVerified: users.emailVerified,
  twoFactorEnabled: users.twoFactorEnabled,
  suspendedAt: users.suspendedAt,
  createdAt: users.createdAt,
};
type Row = { [K in keyof typeof columns]: (typeof users.$inferSelect)[K] };

/**
 * Support's way into an account (5.2c, #13): find the person asking for help by their whole address,
 * and, after an identity check, take their second factor off. Every change is a line of the audit
 * log in its own transaction, and so is opening an account's page (its name and address are personal
 * data). Staff never act on their own account or another staff member's: a stolen admin session must
 * not be able to open the others' accounts (staff are recovered by hand).
 */
@Injectable()
export class AdminUsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Only whether the address has an account, and its id: what the page then shows is logged. */
  async lookup({ email }: AdminUserLookup): Promise<AdminUserLookupResult> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return AdminUserLookupResultSchema.parse({ id: row?.id ?? null });
  }

  /** An account's page, and the line in the log that says who opened it. */
  async open(adminId: string, id: string): Promise<AdminUser> {
    if (!UUID.test(id)) throw refused(404, 'USER_NOT_FOUND');
    const user = await this.read(adminId, id);
    await this.db.transaction((tx) =>
      recordAudit(tx, {
        actorId: adminId,
        action: 'user.viewed',
        targetType: 'user',
        targetId: id,
      }),
    );
    return user;
  }

  /**
   * Suspends an account (#79): it can't sign in, every session ends, its reset links go, and the
   * person is told, without the reason (the note is for the log alone). Nothing it holds changes
   * (#80): its listings and bookings stand, and staff are shown the live listings so they can act on
   * them one by one. Not staff, not yourself; a second admin finds it done (`ALREADY_SUSPENDED`).
   */
  async suspend(adminId: string, id: string, { note }: AdminReasonInput): Promise<AdminUser> {
    await this.change(adminId, id, async (tx, row) => {
      if (row.suspendedAt) throw refused(409, 'ALREADY_SUSPENDED');
      await tx.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, id));
      const ended = await tx
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, id))
        .returning({ id: schema.sessions.id });
      await tx.delete(schema.verifications).where(eq(schema.verifications.value, id));
      await this.tell(tx, id, 'account-suspended');
      await recordAudit(tx, {
        actorId: adminId,
        action: 'user.suspended',
        targetType: 'user',
        targetId: id,
        details: { note, sessionsEnded: ended.length },
      });
    });
    return this.read(adminId, id);
  }

  /** Lifts a suspension (#81): the password works again, the person is told, the note is the log's. */
  async reinstate(adminId: string, id: string, { note }: AdminReasonInput): Promise<AdminUser> {
    await this.change(adminId, id, async (tx, row) => {
      if (!row.suspendedAt) throw refused(409, 'NOT_SUSPENDED');
      await tx.update(users).set({ suspendedAt: null }).where(eq(users.id, id));
      await this.tell(tx, id, 'account-reinstated');
      await recordAudit(tx, {
        actorId: adminId,
        action: 'user.reinstated',
        targetType: 'user',
        targetId: id,
        details: { note },
      });
    });
    return this.read(adminId, id);
  }

  /** The account's row under its lock, refused for the reader's own and for staff (as removal is). */
  private async change(
    adminId: string,
    id: string,
    work: (
      tx: Parameters<Parameters<Database['transaction']>[0]>[0],
      row: { suspendedAt: Date | null },
    ) => Promise<void>,
  ): Promise<void> {
    if (!UUID.test(id)) throw refused(404, 'USER_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: users.id, role: users.role, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, id))
        .for('no key update');
      if (!row) throw refused(404, 'USER_NOT_FOUND');
      if (row.id === adminId) throw refused(403, 'OWN_ACCOUNT');
      if (row.role === 'admin') throw refused(403, 'STAFF_ACCOUNT');
      await work(tx, row);
    });
  }

  private async tell(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    userId: string,
    kind: 'account-suspended' | 'account-reinstated',
  ): Promise<void> {
    await tx
      .insert(schema.emailOutbox)
      .values({ kind, userId, dedupeKey: `${kind}:${userId}:${randomUUID()}` })
      .onConflictDoNothing({ target: schema.emailOutbox.dedupeKey });
  }

  /**
   * Removes the second factor, ends every session of the account, revokes its password and tells
   * its address (#13). The password goes too: a note nobody can check is the only proof of who
   * asked, so the person gets back in through the emailed reset, which proves they hold the mailbox.
   * One transaction under the account's row lock: a second admin pressing at once finds it already
   * done (`NO_TWO_FACTOR`), and the email is queued only if the change commits.
   */
  async removeTwoFactor(
    adminId: string,
    id: string,
    { note }: AdminRemoveTwoFactorInput,
  ): Promise<AdminUser> {
    if (!UUID.test(id)) throw refused(404, 'USER_NOT_FOUND');
    await this.db.transaction(async (tx) => {
      // `no key update`: the account's key stays, so sign-ins and bookings of theirs don't wait.
      const [row] = await tx
        .select({ id: users.id, role: users.role, twoFactorEnabled: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.id, id))
        .for('no key update');
      if (!row) throw refused(404, 'USER_NOT_FOUND');
      if (row.id === adminId) throw refused(403, 'OWN_ACCOUNT');
      if (row.role === 'admin') throw refused(403, 'STAFF_ACCOUNT');
      if (!row.twoFactorEnabled) throw refused(409, 'NO_TWO_FACTOR');

      await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, id));
      await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, id));
      // Whoever holds a session now got past the second step with the factor that is gone.
      const ended = await tx
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, id))
        .returning({ id: schema.sessions.id });
      // The password no longer opens the account; the reset link does. What it may still allow
      // goes too: reset links already sent, and the devices trusted to skip the code.
      await tx
        .update(schema.accounts)
        .set({ password: null })
        .where(and(eq(schema.accounts.userId, id), eq(schema.accounts.providerId, 'credential')));
      await tx.delete(schema.verifications).where(eq(schema.verifications.value, id));
      await tx
        .insert(schema.emailOutbox)
        .values({
          kind: 'two-factor-removed',
          userId: id,
          dedupeKey: `two-factor-removed:${id}:${randomUUID()}`,
        })
        .onConflictDoNothing({ target: schema.emailOutbox.dedupeKey });
      await recordAudit(tx, {
        actorId: adminId,
        action: 'user.two_factor_removed',
        targetType: 'user',
        targetId: id,
        details: { note, sessionsEnded: ended.length, passwordRevoked: true },
      });
    });
    // Read once it is committed, on the pool, and not logged as an opening: the person who did this
    // is already in the log for it.
    return this.read(adminId, id);
  }

  private async read(adminId: string, id: string): Promise<AdminUser> {
    const [row] = await this.db.select(columns).from(users).where(eq(users.id, id));
    if (!row) throw refused(404, 'USER_NOT_FOUND');
    // Live listings it is the primary owner of (#80): on the owner profile's own index.
    const [live] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.parkingLocations)
      .innerJoin(schema.ownerProfiles, eq(schema.ownerProfiles.id, schema.parkingLocations.ownerId))
      .where(
        and(eq(schema.ownerProfiles.userId, id), eq(schema.parkingLocations.status, 'published')),
      );
    return present(row, adminId, live?.count ?? 0);
  }
}

function present(row: Row, adminId: string, liveListings: number): AdminUser {
  const own = row.id === adminId;
  const { suspendedAt, ...facts } = row;
  const ordinary = row.role !== 'admin' && !own;
  return AdminUserSchema.parse({
    ...facts,
    createdAt: row.createdAt.toISOString(),
    own,
    canRemoveTwoFactor: row.twoFactorEnabled && ordinary,
    suspended: suspendedAt !== null,
    canSuspend: ordinary && suspendedAt === null,
    canReinstate: ordinary && suspendedAt !== null,
    liveListings,
  });
}
