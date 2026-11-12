import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  OwnerPayoutsSchema,
  PayoutLinkInputSchema,
  PayoutLinkSchema,
  type OwnerPayouts,
  type PayoutLink,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { PayoutsService } from './payouts.service.js';

/** Each link is a call to Stripe; nobody needs more than a few a minute. */
const LINK_LIMIT = { default: { limit: 10, ttl: 60_000 } };
/** The payouts page and the dashboard's card read it; an owner reloading needs no more. */
const STATUS_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** The owner's payout account (decision #48). Only ever the signed-in owner's own. */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  /** Asks Stripe at most once a minute per account; the limit keeps reloads off Stripe too. */
  @Get()
  @Throttle(STATUS_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(OwnerPayoutsSchema) })
  @ApiServiceUnavailableResponse({ schema: schemaRef(ErrorResponseSchema) })
  getOwnerPayouts(@CurrentUser() user: AuthUser): Promise<OwnerPayouts> {
    return this.payouts.status(user.id);
  }

  /** Stripe's onboarding; `PROFILE_REQUIRED` before the owner said who they are. */
  @Post('onboarding')
  @HttpCode(200)
  @Throttle(LINK_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(PayoutLinkInputSchema) })
  @ApiOkResponse({ schema: schemaRef(PayoutLinkSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: schemaRef(ErrorResponseSchema) })
  startPayoutOnboarding(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<PayoutLink> {
    return this.payouts.onboardingLink(user.id, parseOrThrow(PayoutLinkInputSchema, body).locale);
  }

  /** A sign-in to the owner's Stripe dashboard; `PAYOUTS_NOT_STARTED` before onboarding is done. */
  @Post('dashboard')
  @HttpCode(200)
  @Throttle(LINK_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(PayoutLinkSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: schemaRef(ErrorResponseSchema) })
  openPayoutDashboard(@CurrentUser() user: AuthUser): Promise<PayoutLink> {
    return this.payouts.dashboardLink(user.id);
  }
}
