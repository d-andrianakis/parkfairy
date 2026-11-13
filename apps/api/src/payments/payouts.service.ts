import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  OwnerPayoutsSchema,
  PayoutLinkSchema,
  type Locale,
  type OwnerPayouts,
  type PayoutLink,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, eq, lte } from 'drizzle-orm';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { conflict } from '../owner/owner.errors.js';
import { PAYMENTS } from './payments.tokens.js';
import {
  PaymentProviderError,
  type AccountStatus,
  type PaymentsGateway,
} from '@parkfairy/payments';

/** How long Stripe's last word stands before a page asks again: the webhook keeps it current. */
const FRESH_MS = 60_000;

const profile = schema.ownerProfiles;
const payout = schema.payoutAccounts;
const users = schema.users;

function unavailable(code: 'PAYMENTS_UNAVAILABLE' | 'PAYMENT_PROVIDER_ERROR') {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: code,
    code,
  });
}

/** Stripe failed: the owner can try again; what failed stays out of the answer. */
async function viaStripe<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PaymentProviderError) throw unavailable('PAYMENT_PROVIDER_ERROR');
    throw error;
  }
}

/**
 * Owners' payout accounts (decision #48): an Express account each, set up in Stripe's hosted
 * onboarding. Every call starts from the session's user, so an owner only ever reaches their own.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Pick<Env, 'webOrigin'>,
    @Inject(PAYMENTS) private readonly payments: PaymentsGateway | null,
  ) {}

  private async accountOf(userId: string) {
    const [row] = await this.db
      .select({
        ownerId: profile.id,
        kind: profile.kind,
        country: profile.country,
        email: users.email,
        accountId: payout.stripeAccountId,
        status: payout.status,
        statusAt: payout.statusAt,
      })
      .from(profile)
      .innerJoin(users, eq(users.id, profile.userId))
      .leftJoin(payout, eq(payout.ownerId, profile.id))
      .where(eq(profile.userId, userId));
    return row ?? null;
  }

  /**
   * Where the owner's payouts stand. Until active, asked of Stripe as well, at most once a minute:
   * an owner just back from onboarding shouldn't wait for the webhook to see what they did, and a
   * page reloaded in a loop mustn't spend the platform's Stripe rate limit.
   */
  async status(userId: string): Promise<OwnerPayouts> {
    const gateway = this.payments;
    const account = await this.accountOf(userId);
    const answer = (status: OwnerPayouts['status']) =>
      OwnerPayoutsSchema.parse({ available: gateway !== null, status });
    if (!account?.accountId || !account.status) return answer('none');
    const fresh = account.statusAt && Date.now() - account.statusAt.getTime() < FRESH_MS;
    if (!gateway || account.status === 'active' || fresh) return answer(account.status);
    let status;
    // When asked, not answered: an `account.updated` from during the call is the newer word.
    const asked = new Date();
    try {
      status = await gateway.accountStatus(account.accountId);
    } catch (error) {
      // What we last heard stands: the webhook will tell us when it changes.
      if (error instanceof PaymentProviderError) return answer(account.status);
      throw error;
    }
    await this.record(account.accountId, status, asked);
    return answer(status);
  }

  /**
   * A link into Stripe's onboarding, the owner's account made first if they have none. Back to the
   * payouts page in the owner's language when done, or to ask again when the link ran out.
   */
  async onboardingLink(userId: string, locale: Locale): Promise<PayoutLink> {
    const gateway = this.payments;
    if (!gateway) throw unavailable('PAYMENTS_UNAVAILABLE');
    const account = await this.accountOf(userId);
    // Who they are decides the account's kind and country.
    if (!account?.kind) throw conflict('PROFILE_REQUIRED');
    let accountId = account.accountId;
    if (!accountId) {
      const { ownerId, email, country, kind } = account;
      const created = await viaStripe(() =>
        gateway.createPayoutAccount({
          ownerId,
          email,
          country,
          businessType: kind === 'business' ? 'company' : 'individual',
        }),
      );
      // Two presses at once made one account (Stripe's idempotency key): the first row stands.
      await this.db
        .insert(payout)
        .values({ ownerId, stripeAccountId: created })
        .onConflictDoNothing({ target: payout.ownerId });
      accountId = created;
    }
    const page = `${this.env.webOrigin}/${locale}/owner/payouts`;
    const url = await viaStripe(() =>
      gateway.onboardingLink({
        accountId: accountId,
        refreshUrl: `${page}?link=expired`,
        returnUrl: `${page}?link=returned`,
      }),
    );
    return PayoutLinkSchema.parse({ url });
  }

  /** A sign-in to the owner's Express dashboard, once they finished onboarding. */
  async dashboardLink(userId: string): Promise<PayoutLink> {
    const gateway = this.payments;
    if (!gateway) throw unavailable('PAYMENTS_UNAVAILABLE');
    const account = await this.accountOf(userId);
    if (!account?.accountId || account.status === 'restricted') {
      throw conflict('PAYOUTS_NOT_STARTED');
    }
    const url = await viaStripe(() => gateway.dashboardLink(account.accountId as string));
    return PayoutLinkSchema.parse({ url });
  }

  /**
   * What Stripe says of an account, from a webhook or a look of our own. An older word never
   * overwrites a newer one: events can arrive out of order.
   */
  async record(accountId: string, status: AccountStatus, at: Date): Promise<void> {
    await this.db
      .update(payout)
      .set({ status, statusAt: at })
      .where(and(eq(payout.stripeAccountId, accountId), lte(payout.statusAt, at)));
  }
}
