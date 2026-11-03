import 'server-only';
import type { AuthEmail } from '@parkfairy/auth';
import { ACCOUNT_LINK_LIFETIME } from '@parkfairy/contracts';
import { renderEmail } from '@parkfairy/email';
import { createTranslator } from 'next-intl';
import el from '@/messages/el.json';
import en from '@/messages/en.json';
import type { OutgoingEmail } from './transport';

const CATALOGS = { el, en };

/** The catalog section of each kind of email; every section has the same keys. */
const SECTIONS = {
  'verify-email': 'verifyEmail',
  'reset-password': 'resetPassword',
  'password-changed': 'passwordChanged',
  'existing-account': 'existingAccount',
} as const satisfies Record<AuthEmail['kind'], string>;

/*
 * The body is built only from catalog text and our own link. The account name is left out on
 * purpose: anyone can sign up with someone else's address, and a name is free text they would
 * get to put in front of that person, from our domain.
 */
export function renderAuthEmail({ kind, to, locale, url }: AuthEmail): OutgoingEmail {
  const t = createTranslator({
    locale,
    messages: CATALOGS[locale],
    namespace: `Email.${SECTIONS[kind]}`,
  });
  const shared = createTranslator({ locale, messages: CATALOGS[locale], namespace: 'Email' });

  const lifetime = {
    hours: ACCOUNT_LINK_LIFETIME.verifyEmailHours,
    minutes: ACCOUNT_LINK_LIFETIME.resetPasswordMinutes,
  };
  return renderEmail({
    to,
    locale,
    subject: t('subject'),
    heading: t('heading'),
    body: t('body', lifetime),
    action: t('action'),
    url,
    note: t('note'),
    linkFallback: shared('linkFallback'),
    footer: shared('footer'),
  });
}
