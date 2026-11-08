import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { EMAIL_OUTBOX } from './env';

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Everything sent to an address so far, oldest first (file names start with the time). */
export async function emailsTo(address: string): Promise<SentEmail[]> {
  if (!EMAIL_OUTBOX) throw new Error('Reading emails needs the local outbox (EMAIL_OUTBOX)');
  await mkdir(EMAIL_OUTBOX, { recursive: true });
  const names = (await readdir(EMAIL_OUTBOX)).filter((name) => name.endsWith('.json')).sort();
  const emails = await Promise.all(
    names.map(
      async (name) =>
        JSON.parse(await readFile(join(EMAIL_OUTBOX as string, name), 'utf8')) as SentEmail,
    ),
  );
  return emails.filter((email) => email.to === address);
}

/**
 * The newest email with this subject, waiting for it: emails go out after the response. The
 * worker's go out on its next send, every 30 seconds, so those need a longer `timeout`.
 */
export async function waitForEmail(
  address: string,
  subject: string,
  { timeout }: { timeout?: number } = {},
): Promise<SentEmail> {
  let found: SentEmail | undefined;
  await expect
    .poll(
      async () => {
        found = (await emailsTo(address)).findLast((email) => email.subject === subject);
        return found?.subject;
      },
      { timeout },
    )
    .toBe(subject);
  return found as SentEmail;
}

/** The link in an email's plain-text part, which is what the HTML button points to as well. */
export function emailLink(email: SentEmail): string {
  const link = /https?:\/\/\S+/.exec(email.text)?.[0];
  if (!link) throw new Error(`No link in "${email.subject}"`);
  expect(email.html).toContain(link.replaceAll('&', '&amp;'));
  return link;
}
