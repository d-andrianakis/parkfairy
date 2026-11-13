import { describe, expect, it } from 'vitest';
import {
  INVITE_TOKEN_PATTERN,
  InvitePreviewSchema,
  InviteTokenInputSchema,
  LISTING_OWNER_ERROR_CODES,
  ListingInviteInputSchema,
  ListingOwnersSchema,
  ListingSharesInputSchema,
} from './listing-owners.js';

const A = '0b4e8a8e-6f4c-4a3c-9a43-1f2d3c4b5a60';
const B = '1c5f9b9f-7a5d-4b4d-8b54-2a3e4d5c6b71';

describe('ListingSharesInputSchema', () => {
  it('takes whole percentages adding up to 100, each owner once', () => {
    expect(
      ListingSharesInputSchema.parse({
        shares: [
          { ownerId: A, percent: 70 },
          { ownerId: B, percent: 30 },
        ],
      }).shares,
    ).toHaveLength(2);
    // An owner at 0% helps run the listing and is paid nothing (#54's readings).
    expect(
      ListingSharesInputSchema.safeParse({
        shares: [
          { ownerId: A, percent: 100 },
          { ownerId: B, percent: 0 },
        ],
      }).success,
    ).toBe(true);
  });

  it('says why it refuses: a total that isn’t 100, a fraction, an owner twice', () => {
    const issues = (shares: unknown) =>
      ListingSharesInputSchema.safeParse({ shares }).error?.issues.map((issue) => issue.message);
    expect(
      issues([
        { ownerId: A, percent: 60 },
        { ownerId: B, percent: 30 },
      ]),
    ).toContain('sharesTotal');
    expect(issues([{ ownerId: A, percent: 99.5 }])).toContain('shareInvalid');
    expect(issues([{ ownerId: A, percent: 101 }])).toContain('shareInvalid');
    expect(
      issues([
        { ownerId: A, percent: 50 },
        { ownerId: A, percent: 50 },
      ]),
    ).toContain('invalid');
  });
});

describe('invites', () => {
  it('asks for an address and the language the email is written in', () => {
    expect(ListingInviteInputSchema.parse({ email: 'eleni@example.gr', locale: 'el' })).toEqual({
      email: 'eleni@example.gr',
      locale: 'el',
    });
    expect(
      ListingInviteInputSchema.safeParse({ email: 'not an address', locale: 'el' }).error?.issues[0]
        ?.message,
    ).toBe('emailInvalid');
    expect(ListingInviteInputSchema.safeParse({ email: 'a@b.gr', locale: 'fr' }).success).toBe(
      false,
    );
  });

  it('takes only a token of the shape it was made in', () => {
    const token = 'A'.repeat(43);
    expect(INVITE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(InviteTokenInputSchema.parse({ token })).toEqual({ token });
    for (const bad of ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, '../../etc/passwd']) {
      expect(InviteTokenInputSchema.safeParse({ token: bad }).success, bad).toBe(false);
    }
  });

  it('previews an invite without its owners or address', () => {
    const preview = InvitePreviewSchema.parse({
      state: 'open',
      listingName: 'Γκαράζ Ερμού',
      contentLocale: 'el',
      invitedBy: 'Maria',
      forYou: true,
      address: 'Ερμού 1',
    });
    expect(preview).not.toHaveProperty('address');
    expect(InvitePreviewSchema.safeParse({ ...preview, state: 'pending' }).success).toBe(false);
  });
});

describe('ListingOwnersSchema', () => {
  it('says each owner’s role, share and payouts, and whether drivers can book', () => {
    const owners = ListingOwnersSchema.parse({
      listingId: A,
      name: 'Garage',
      contentLocale: 'en',
      role: 'co_owner',
      owners: [
        {
          id: A,
          name: 'Maria',
          email: 'maria@example.gr',
          role: 'primary',
          sharePercent: 100,
          payouts: 'active',
          you: false,
        },
        {
          id: B,
          name: null,
          email: 'eleni@example.gr',
          role: 'co_owner',
          sharePercent: 0,
          payouts: 'none',
          you: true,
        },
      ],
      invites: [],
      payable: true,
      room: 8,
    });
    expect(owners.owners.map((owner) => owner.role)).toEqual(['primary', 'co_owner']);
    expect(ListingOwnersSchema.safeParse({ ...owners, role: 'manager' }).success).toBe(false);
  });

  it('names every code a co-ownership route answers with', () => {
    expect(LISTING_OWNER_ERROR_CODES).toContain('PRIMARY_ONLY');
    expect(LISTING_OWNER_ERROR_CODES).toContain('INVITE_FOR_ANOTHER_ACCOUNT');
    expect(new Set(LISTING_OWNER_ERROR_CODES).size).toBe(LISTING_OWNER_ERROR_CODES.length);
  });
});
