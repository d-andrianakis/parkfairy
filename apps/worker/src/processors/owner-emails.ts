import {
  claimDueEmails,
  countOverdueEmails,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  markEmailFailed,
  markEmailSent,
  purgeSentEmails,
} from '@parkfairy/database';
import { OWNER_EMAIL_KINDS, renderOwnerEmail, type OwnerEmailLocale } from '@parkfairy/email';
import { QUEUES, type QueueProcessor } from '../queues.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Quiet this long after their last change, and an owner gets the one reminder. */
export const REMINDER_AFTER_DAYS = 3;
/** Long enough to look into a complaint. */
export const SENT_EMAIL_DAYS = 90;
/** Each run; Resend's limit paces the sends inside the transport. */
const SEND_BATCH = 20;

const KINDS = new Set<string>(OWNER_EMAIL_KINDS);

/**
 * Owner emails. The sweeps turn what happened into outbox rows, and the sender drains them.
 * Every job is safe to repeat: rows carry a dedupe key, and the outbox id is the idempotency key.
 */
export const ownerEmailsProcessor: QueueProcessor = {
  queue: QUEUES.email,
  concurrency: 1,
  schedules: [
    { id: 'enqueue-listing-status-emails', everyMs: MINUTE_MS },
    { id: 'enqueue-onboarding-reminders', everyMs: 60 * MINUTE_MS },
    { id: 'send-owner-emails', everyMs: 30_000 },
    { id: 'purge-sent-emails', everyMs: DAY_MS },
  ],
  async process(job, { db, logger, email }) {
    switch (job.name) {
      case 'enqueue-listing-status-emails': {
        const queued = await enqueueListingStatusEmails(db);
        if (queued > 0) logger.info({ queued }, 'listing status emails queued');
        return { queued };
      }
      case 'enqueue-onboarding-reminders': {
        const before = new Date(Date.now() - REMINDER_AFTER_DAYS * DAY_MS);
        const queued = await enqueueOnboardingReminders(db, before);
        if (queued > 0) logger.info({ queued }, 'onboarding reminders queued');
        return { queued };
      }
      case 'send-owner-emails': {
        const due = await claimDueEmails(db, SEND_BATCH);
        let sent = 0;
        for (const row of due) {
          try {
            if (!KINDS.has(row.kind)) throw new Error(`Unknown email kind "${row.kind}"`);
            await email.transport.send({
              ...renderOwnerEmail({
                kind: row.kind,
                to: row.to,
                locale: row.locale as OwnerEmailLocale,
                webUrl: email.webUrl,
                listingName: row.payload.listingName,
              }),
              idempotencyKey: row.id,
            });
            await markEmailSent(db, row.id);
            sent++;
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error';
            const gaveUp = await markEmailFailed(db, row, reason);
            // The id and kind only: the address must stay out of the logs.
            const details = { emailId: row.id, kind: row.kind, reason };
            if (gaveUp) logger.error(details, 'owner email given up on');
            else logger.warn(details, 'owner email not sent');
          }
        }
        const overdue = await countOverdueEmails(db, new Date(Date.now() - DAY_MS));
        if (overdue > 0) logger.error({ overdue }, 'owner emails waiting for over a day');
        return { sent, failed: due.length - sent };
      }
      case 'purge-sent-emails': {
        const purged = await purgeSentEmails(db, new Date(Date.now() - SENT_EMAIL_DAYS * DAY_MS));
        logger.info({ purged }, 'old sent emails purged');
        return { purged };
      }
      default:
        throw new Error(`Unknown email job "${job.name}"`);
    }
  },
};
