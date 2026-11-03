import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  normalizeTaxNumber,
  OwnerProfileSchema,
  type OwnerProfile,
  type OwnerProfilePatch,
  type OwnerTaxInput,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import { FIELD_CRYPTO } from './field-crypto.provider.js';
import type { FieldCrypto } from './field-crypto.js';
import { conflict } from './owner.errors.js';
import type { ProfileFacts } from './onboarding-progress.js';

const profiles = schema.ownerProfiles;
export type OwnerProfileRow = typeof profiles.$inferSelect;

/** How much of a saved tax value the owner is shown back. */
const ENDING_LENGTH = 3;

/** Changing any of these changes who was checked. */
const IDENTITY_FIELDS = ['kind', 'firstName', 'lastName', 'legalName'] as const;

/** A verified owner who changes who they are goes back to being checked. */
const reverified = ({ verification }: OwnerProfileRow, changed: boolean) =>
  changed && verification === 'verified' ? { verification: 'pending' as const } : {};

export function profileFacts(row: OwnerProfileRow): ProfileFacts {
  return {
    ...row,
    hasTaxId: row.taxIdEncrypted !== null,
    hasBirthDate: row.birthDateEncrypted !== null,
    hasRegistrationNumber: row.registrationNumberEncrypted !== null,
  };
}

@Injectable()
export class OwnerProfileService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  async find(userId: string): Promise<OwnerProfileRow | undefined> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, userId));
    return row;
  }

  /** The owner's profile, created on first use: one per account, whoever gets there first. */
  async ensure(userId: string): Promise<OwnerProfileRow> {
    await this.db.insert(profiles).values({ userId }).onConflictDoNothing();
    const row = await this.find(userId);
    if (!row) throw new Error('Owner profile missing right after insert');
    return row;
  }

  async get(userId: string): Promise<OwnerProfile> {
    return this.toProfile((await this.find(userId)) ?? (await this.ensure(userId)));
  }

  async patch(userId: string, patch: OwnerProfilePatch): Promise<OwnerProfile> {
    const current = await this.ensure(userId);
    const [row] = await this.db
      .update(profiles)
      .set({
        ...patch,
        // What applied to the other kind of owner no longer does, so it isn't kept.
        ...(patch.kind === 'business' ? { birthDateEncrypted: null } : {}),
        ...(patch.kind === 'individual' ? { registrationNumberEncrypted: null } : {}),
        ...reverified(
          current,
          IDENTITY_FIELDS.some((field) => field in patch),
        ),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId))
      .returning();
    if (!row) throw new Error('Owner profile vanished during an update');
    return this.toProfile(row);
  }

  /**
   * Stores tax details encrypted. Empty fields keep what is saved, because saved values never
   * go back to the browser; the one exception is a change of country, which makes the old
   * number meaningless, so a new one must come with it.
   */
  async saveTax(userId: string, tax: OwnerTaxInput): Promise<OwnerProfile> {
    const row = await this.ensure(userId);
    if (!row.kind) throw conflict('PROFILE_INCOMPLETE');
    const hasTaxId = tax.taxId !== undefined || row.taxIdEncrypted !== null;
    if (!hasTaxId || (tax.taxCountry !== row.taxCountry && tax.taxId === undefined)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['taxIdRequired'],
        code: 'VALIDATION_FAILED',
      });
    }
    const seal = (field: string, value: string | undefined) =>
      value === undefined
        ? undefined
        : this.crypto.encrypt(value.toUpperCase(), `${row.id}:${field}`);

    const [updated] = await this.db
      .update(profiles)
      .set({
        taxCountry: tax.taxCountry,
        taxIdEncrypted: seal('taxId', tax.taxId && normalizeTaxNumber(tax.taxId)),
        vatIdEncrypted: seal('vatId', tax.vatId && normalizeTaxNumber(tax.vatId)),
        // Each kind keeps only what applies to it.
        registrationNumberEncrypted:
          row.kind === 'business' ? seal('registrationNumber', tax.registrationNumber) : undefined,
        birthDateEncrypted:
          row.kind === 'individual' ? seal('birthDate', tax.birthDate) : undefined,
        ...reverified(row, true),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, row.id))
      .returning();
    if (!updated) throw new Error('Owner profile vanished during an update');
    return this.toProfile(updated);
  }

  private toProfile(row: OwnerProfileRow): OwnerProfile {
    const ending = (field: string, stored: string | null) =>
      stored === null
        ? null
        : this.crypto.decrypt(stored, `${row.id}:${field}`).slice(-ENDING_LENGTH);
    return OwnerProfileSchema.parse({
      ...row,
      tax: {
        taxCountry: row.taxCountry,
        taxIdEnding: ending('taxId', row.taxIdEncrypted),
        vatIdEnding: ending('vatId', row.vatIdEncrypted),
        registrationEnding: ending('registrationNumber', row.registrationNumberEncrypted),
        birthDateSaved: row.birthDateEncrypted !== null,
      },
    });
  }
}
