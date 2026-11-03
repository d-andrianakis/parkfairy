/**
 * Owner profiles: what makes an account an owner (`users.role` stays platform staff only). One
 * per account, built up step by step, so everything but the account link may be empty.
 *
 * Tax values are encrypted by the API before they reach this table (`*_encrypted`), so a leaked
 * dump or backup doesn't hold them in the clear.
 */
import {
  DEFAULT_COUNTRY,
  EU_COUNTRIES,
  OWNER_KINDS,
  OWNER_LIMITS,
  OWNER_VERIFICATION_STATES,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const limit = (value: number) => sql.raw(String(value));

export const ownerProfiles = pgTable(
  'owner_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Restrict, not cascade: listings and, later, payouts hang off this row.
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<(typeof OWNER_KINDS)[number]>(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    legalName: text('legal_name'),
    phone: text('phone'),
    addressLine: text('address_line'),
    city: text('city'),
    postalCode: text('postal_code'),
    country: char('country', { length: 2 })
      .$type<(typeof EU_COUNTRIES)[number]>()
      .notNull()
      .default(DEFAULT_COUNTRY),
    taxCountry: char('tax_country', { length: 2 })
      .$type<(typeof EU_COUNTRIES)[number]>()
      .notNull()
      .default(DEFAULT_COUNTRY),
    taxIdEncrypted: text('tax_id_encrypted'),
    vatIdEncrypted: text('vat_id_encrypted'),
    registrationNumberEncrypted: text('registration_number_encrypted'),
    birthDateEncrypted: text('birth_date_encrypted'),
    verification: text('verification')
      .$type<(typeof OWNER_VERIFICATION_STATES)[number]>()
      .notNull()
      .default('unverified'),
    /** When the one reminder went out; set, it never goes again. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Last change by the owner, for the reminder. */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // For the worker's sweep of owners who stalled; submitting moves them out of `unverified`.
    index('owner_profiles_reminder_idx')
      .on(t.updatedAt)
      .where(sql`${t.reminderSentAt} is null and ${t.verification} = 'unverified'`),
    check(
      'owner_profiles_kind_check',
      sql`${t.kind} is null or ${t.kind} in (${sqlList(OWNER_KINDS)})`,
    ),
    check('owner_profiles_country_check', sql`${t.country} in (${sqlList(EU_COUNTRIES)})`),
    check('owner_profiles_tax_country_check', sql`${t.taxCountry} in (${sqlList(EU_COUNTRIES)})`),
    check(
      'owner_profiles_verification_check',
      sql`${t.verification} in (${sqlList(OWNER_VERIFICATION_STATES)})`,
    ),
    check(
      'owner_profiles_text_length_check',
      sql`(${t.firstName} is null or char_length(${t.firstName}) <= ${limit(OWNER_LIMITS.name)}) and (${t.lastName} is null or char_length(${t.lastName}) <= ${limit(OWNER_LIMITS.name)}) and (${t.legalName} is null or char_length(${t.legalName}) <= ${limit(OWNER_LIMITS.legalName)}) and (${t.phone} is null or char_length(${t.phone}) <= ${limit(OWNER_LIMITS.phone)}) and (${t.addressLine} is null or char_length(${t.addressLine}) <= ${limit(OWNER_LIMITS.addressLine)}) and (${t.city} is null or char_length(${t.city}) <= ${limit(OWNER_LIMITS.city)}) and (${t.postalCode} is null or char_length(${t.postalCode}) <= ${limit(OWNER_LIMITS.postalCode)})`,
    ),
  ],
);
