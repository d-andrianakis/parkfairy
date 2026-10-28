/**
 * Better Auth identity tables.
 *
 * Better Auth is the single identity authority; these tables are owned by it and
 * must stay in sync with the plugins configured in `@parkfairy/auth`. The JS keys
 * are the Better Auth field names; the SQL names follow our snake_case convention.
 * Business data (owner profiles, bookings, ...) lives in separate tables that
 * reference `users.id`.
 */
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    // Platform staff role. Owner capability is derived from owner profiles, not from this column.
    role: text('role').$type<UserRole>().default('user').notNull(),
    // Preferred UI/email language; set at sign-up and when the user switches language.
    locale: text('locale').$type<Locale>().default(DEFAULT_LOCALE).notNull(),
    twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} in (${sqlList(USER_ROLES)})`),
    check('users_locale_check', sql`${t.locale} in (${sqlList(SUPPORTED_LOCALES)})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [
    index('two_factors_secret_idx').on(t.secret),
    index('two_factors_user_id_idx').on(t.userId),
  ],
);

/** Model-name → table map in the shape the Better Auth Drizzle adapter expects. */
export const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  twoFactor: twoFactors,
};
