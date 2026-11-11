import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { users } from './schema/auth.js';
import { emailOutbox, type OutboxEmailKind, type OutboxPayload } from './schema/email-outbox.js';

/** Per sweep, so one run never holds locks on much of a table. */
const SWEEP_LIMIT = 200;
/**
 * How long a claimed email stays out of other workers' reach: past the sender's run, which stops
 * at 25 s whatever Resend does, so a worker that dies gives its emails back within minutes.
 */
const CLAIM_MINUTES = 2;
/** Backoff doubles from 2 minutes, so this is about a day and a half, then a person should look. */
export const MAX_EMAIL_ATTEMPTS = 11;

/**
 * Queues an email for every listing whose status nobody has been told about. Keyed on the
 * column, not on who changed it, so a status changed by hand in the database emails the owner
 * just as the admin screen will. One statement: the email and the mark that it is queued commit
 * together, and `skip locked` lets a second worker pass over rows the first has taken.
 *
 * The dedupe key includes the submission, so a second round of review emails again.
 */
export async function enqueueListingStatusEmails(db: Database): Promise<number> {
  const result = await db.execute(sql`
    with due as (
      select l.id, l.status, l.name, l.content_locale, l.submitted_at, p.user_id
      from parking_locations l
      join owner_profiles p on p.id = l.owner_id
      where l.owner_id is not null
        and l.status in ('in_review', 'changes_requested', 'published')
        and l.notified_status is distinct from l.status
      order by l.updated_at
      limit ${SWEEP_LIMIT}
      for update of l skip locked
    ), queued as (
      insert into email_outbox (kind, user_id, payload, dedupe_key)
      select
        case due.status
          when 'in_review' then 'listing-submitted'
          when 'changes_requested' then 'listing-changes-requested'
          else 'listing-approved'
        end,
        due.user_id,
        jsonb_build_object('listingName', due.name, 'contentLocale', due.content_locale),
        concat_ws(':', 'listing', due.id, due.status, extract(epoch from due.submitted_at)::bigint)
      from due
      on conflict (dedupe_key) do nothing
    )
    update parking_locations l
    set notified_status = due.status
    from due
    where l.id = due.id
  `);
  return result.rowCount ?? 0;
}

/**
 * Queues the one reminder for owners who stopped before submitting anything: nothing touched
 * since `before`, on the profile or any listing, and nothing of theirs with staff or live.
 * Once only: `reminder_sent_at` is never cleared.
 */
export async function enqueueOnboardingReminders(db: Database, before: Date): Promise<number> {
  const cutoff = before.toISOString();
  const result = await db.execute(sql`
    with due as (
      select p.id, p.user_id
      from owner_profiles p
      where p.reminder_sent_at is null
        and p.verification = 'unverified'
        and p.updated_at < ${cutoff}
        and not exists (
          select 1 from parking_locations l
          where l.owner_id = p.id and (l.updated_at >= ${cutoff} or l.status <> 'draft')
        )
      order by p.updated_at
      limit ${SWEEP_LIMIT}
      for update of p skip locked
    ), queued as (
      insert into email_outbox (kind, user_id, dedupe_key)
      select 'onboarding-reminder', due.user_id, concat('onboarding-reminder:', due.user_id)
      from due
      on conflict (dedupe_key) do nothing
    )
    update owner_profiles p
    set reminder_sent_at = now()
    from due
    where p.id = due.id
  `);
  return result.rowCount ?? 0;
}

export interface ClaimedEmail {
  id: string;
  kind: OutboxEmailKind;
  attempts: number;
  payload: OutboxPayload;
  to: string;
  locale: string;
}

/**
 * Takes due emails for this worker. Claiming pushes `next_attempt_at` forward instead of holding
 * a transaction open through the sends, so a worker that dies only delays its emails.
 */
export async function claimDueEmails(db: Database, limit: number): Promise<ClaimedEmail[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    update email_outbox
    set next_attempt_at = now() + make_interval(mins => ${CLAIM_MINUTES}), attempts = attempts + 1
    where id in (
      select id from email_outbox
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id
  `);
  const ids = claimed.rows.map((row) => row.id);
  if (ids.length === 0) return [];
  return db
    .select({
      id: emailOutbox.id,
      kind: emailOutbox.kind,
      attempts: emailOutbox.attempts,
      payload: emailOutbox.payload,
      to: users.email,
      locale: users.locale,
    })
    .from(emailOutbox)
    .innerJoin(users, eq(users.id, emailOutbox.userId))
    .where(sql`${emailOutbox.id} in ${ids}`)
    .orderBy(asc(emailOutbox.createdAt));
}

/**
 * Gives back claimed emails the worker didn't finish: its run's time was up, or it is shutting
 * down. They are due again at once, with the try their claim counted given back, since no try
 * was made (or none that can be told apart from one; a send stopped half way is safe to repeat
 * under its idempotency key). A row since sent, given up on or claimed again keeps what it has.
 *
 * Only for emails not marked at all: a row `markEmailFailed` put off is still `pending`, with the
 * same `attempts` and a later `next_attempt_at`, so it would match and get its try back, and the
 * wait between tries and the last try would never come.
 */
export async function releaseEmails(
  db: Database,
  emails: Pick<ClaimedEmail, 'id' | 'attempts'>[],
): Promise<void> {
  if (emails.length === 0) return;
  const claims = sql.join(
    emails.map(({ id, attempts }) => sql`(${id}::uuid, ${attempts}::integer)`),
    sql`, `,
  );
  await db.execute(sql`
    update email_outbox
    set next_attempt_at = now(), attempts = attempts - 1
    where (id, attempts) in (${claims})
      and status = 'pending'
      and next_attempt_at > now()
  `);
}

export async function markEmailSent(db: Database, id: string): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ status: 'sent', sentAt: new Date(), lastError: null })
    .where(eq(emailOutbox.id, id));
}

/**
 * Tries again after a growing wait, then gives up and leaves the row for a person. Answers
 * whether it gave up, because that is worth more than a warning.
 */
export async function markEmailFailed(
  db: Database,
  { id, attempts }: Pick<ClaimedEmail, 'id' | 'attempts'>,
  reason: string,
): Promise<boolean> {
  const exhausted = attempts >= MAX_EMAIL_ATTEMPTS;
  await db
    .update(emailOutbox)
    .set({
      status: exhausted ? 'failed' : 'pending',
      lastError: reason.slice(0, 200),
      nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
    })
    .where(eq(emailOutbox.id, id));
  return exhausted;
}

/** Sent emails are only kept for looking into a complaint. Names of listings go with them. */
export async function purgeSentEmails(db: Database, before: Date): Promise<number> {
  const { rowCount } = await db
    .delete(emailOutbox)
    .where(and(eq(emailOutbox.status, 'sent'), lte(emailOutbox.sentAt, before)));
  return rowCount ?? 0;
}

/** How many emails are stuck waiting, for the logs. */
export async function countOverdueEmails(db: Database, before: Date): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, 'pending'), lte(emailOutbox.createdAt, before)));
  return rows[0]?.value ?? 0;
}
