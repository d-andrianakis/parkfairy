import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  AdminAuditQuerySchema,
  type AdminBooking,
  type AdminBookingLookupResult,
  AdminBookingLookupResultSchema,
  AdminBookingLookupSchema,
  AdminBookingSchema,
  AdminChangesInputSchema,
  AdminDisputeDecisionInputSchema,
  type AdminListingReview,
  AdminListingReviewSchema,
  type AdminPayments,
  AdminPaymentsSchema,
  type AdminQueue,
  AdminQueueQuerySchema,
  AdminQueueSchema,
  AdminReasonInputSchema,
  AdminRemoveTwoFactorInputSchema,
  AdminSuspendListingInputSchema,
  type AdminUser,
  type AdminUserLookupResult,
  AdminUserLookupResultSchema,
  AdminUserLookupSchema,
  AdminUserSchema,
  type AuditLog,
  AuditLogSchema,
  ErrorResponseSchema,
  PROOF_CONTENT_TYPES,
} from '@parkfairy/contracts';
import type { Response } from 'express';

import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import { AdminUsersService } from './admin-users.service.js';

const MINUTE_MS = 60_000;
/** Decisions and proofs opened: a person's pace, not a script's. */
const DECIDE_LIMIT = { default: { limit: 30, ttl: MINUTE_MS } };
/** Looking accounts up one address at a time: a person's pace, not a harvest of addresses. */
const LOOKUP_LIMIT = { default: { limit: 30, ttl: MINUTE_MS } };
/**
 * What takes things away from people (a second factor, an account, a listing): a few a minute, so a
 * stolen staff session can't do it to many (#13, #79).
 */
const MODERATE_LIMIT = { default: { limit: 5, ttl: MINUTE_MS } };

/**
 * A GET that writes a line of the log (a proof opened, an account page opened) is not for a link on
 * another site, nor for a sibling subdomain (`same-site`): a browser says so in `Sec-Fetch-Site`, and
 * cookies marked Lax would otherwise let either through as a navigation.
 */
function refuseOtherSites(fetchSite: string | undefined): void {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'FORBIDDEN',
      code: 'FORBIDDEN',
    });
  }
}
const BINARY = { schema: { type: 'string', format: 'binary' } } as const;

/**
 * What staff do (5.2, #66–#68). Platform staff only (`users.role = 'admin'`) and, for an admin, with
 * a second factor on: the guard answers 403 `MFA_REQUIRED` otherwise. Every action that changes
 * something, and every proof opened, is a line in the audit log.
 */
@ApiTags('admin')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly listings: AdminListingsService,
    private readonly audit: AdminAuditService,
    private readonly accounts: AdminUsersService,
    private readonly bookingsAdmin: AdminBookingsService,
    private readonly payments: AdminPaymentsService,
  ) {}

  @Get('listings')
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(AdminQueueSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminQueue(@Query() rawQuery: unknown): Promise<AdminQueue> {
    return this.listings.queue(parseOrThrow(AdminQueueQuerySchema, rawQuery));
  }

  @Get('listings/:id')
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<AdminListingReview> {
    return this.listings.review(user.id, id);
  }

  /** Always a download, never shown in place, as for the owner; opening one is logged. */
  @Get('listings/:id/proofs/:proofId')
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @ApiProduces(...PROOF_CONTENT_TYPES)
  @ApiOkResponse(BINARY)
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async downloadAdminProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Headers('sec-fetch-site') fetchSite: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    refuseOtherSites(fetchSite);
    const { file, fileName, contentType } = await this.listings.proofFile(user.id, id, proofId);
    response.attachment(fileName);
    // After `attachment`, which guesses the type from the name's extension.
    response.type(contentType);
    return new StreamableFile(file, { type: contentType });
  }

  @Post('listings/:id/approve')
  @HttpCode(200)
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  approveAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<AdminListingReview> {
    return this.listings.approve(user.id, id);
  }

  @Post('listings/:id/request-changes')
  @HttpCode(200)
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminChangesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  requestAdminListingChanges(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminListingReview> {
    return this.listings.requestChanges(user.id, id, parseOrThrow(AdminChangesInputSchema, body));
  }

  /**
   * The account an address belongs to, or none: its id only, never a list. A POST so the address
   * stays out of URLs and logs; it changes nothing.
   */
  @Post('users/lookup')
  @HttpCode(200)
  @Throttle(LOOKUP_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: schemaRef(AdminUserLookupSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminUserLookupResultSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  lookUpAdminUser(@Body() body: unknown): Promise<AdminUserLookupResult> {
    return this.accounts.lookup(parseOrThrow(AdminUserLookupSchema, body));
  }

  /** An account's page: its name and address are personal data, so opening it is logged. */
  @Get('users/:id')
  @Throttle(LOOKUP_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ schema: schemaRef(AdminUserSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('sec-fetch-site') fetchSite: string | undefined,
  ): Promise<AdminUser> {
    refuseOtherSites(fetchSite);
    return this.accounts.open(user.id, id);
  }

  /**
   * Support takes an account's second factor off after an identity check (#13): ends its sessions,
   * revokes its password (the person sets a new one by email), emails its address, and writes the
   * note of how they were identified to the audit log.
   */
  @Post('users/:id/remove-two-factor')
  @HttpCode(200)
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminRemoveTwoFactorInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminUserSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  removeAdminUserTwoFactor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminUser> {
    return this.accounts.removeTwoFactor(
      user.id,
      id,
      parseOrThrow(AdminRemoveTwoFactorInputSchema, body),
    );
  }

  /** Takes a live listing down, and, if staff say so, calls off its upcoming bookings (#78). */
  @Post('listings/:id/suspend')
  @HttpCode(200)
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminSuspendListingInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  suspendAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminListingReview> {
    return this.listings.suspend(user.id, id, parseOrThrow(AdminSuspendListingInputSchema, body));
  }

  @Post('listings/:id/reinstate')
  @HttpCode(200)
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  reinstateAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminListingReview> {
    return this.listings.reinstate(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  /** Suspends an account: no sign-in, every session ended, nothing it holds touched (#79, #80). */
  @Post('users/:id/suspend')
  @HttpCode(200)
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminUserSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  suspendAdminUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminUser> {
    return this.accounts.suspend(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  @Post('users/:id/reinstate')
  @HttpCode(200)
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminUserSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  reinstateAdminUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminUser> {
    return this.accounts.reinstate(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  /** A booking by its reference, or none: its id only, in a body so no reference is in a URL (#85). */
  @Post('bookings/lookup')
  @HttpCode(200)
  @Throttle(LOOKUP_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiBody({ schema: schemaRef(AdminBookingLookupSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminBookingLookupResultSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  lookUpAdminBooking(@Body() body: unknown): Promise<AdminBookingLookupResult> {
    return this.bookingsAdmin.lookup(parseOrThrow(AdminBookingLookupSchema, body));
  }

  /** A booking's page: the driver's name, email and plate are on it, so opening it is logged (#85). */
  @Get('bookings/:id')
  @Throttle(LOOKUP_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ schema: schemaRef(AdminBookingSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('sec-fetch-site') fetchSite: string | undefined,
  ): Promise<AdminBooking> {
    refuseOtherSites(fetchSite);
    return this.bookingsAdmin.open(user.id, id);
  }

  /** Calls a booking off with a full refund, the driver and the owners told (#82). */
  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminBookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  cancelAdminBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminBooking> {
    return this.bookingsAdmin.cancel(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  /** Asks Stripe again for a refund that failed (#84). */
  @Post('bookings/:id/refund/retry')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminBookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  retryAdminBookingRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminBooking> {
    return this.bookingsAdmin.retryRefund(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  /** The driver was paid another way: the failed refund is settled (#84). */
  @Post('bookings/:id/refund/settle')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminReasonInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminBookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  settleAdminBookingRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminBooking> {
    return this.bookingsAdmin.settleRefund(user.id, id, parseOrThrow(AdminReasonInputSchema, body));
  }

  /** What needs support in money: lost disputes to decide, disputes open, refunds that failed. */
  @Get('payments')
  @Throttle(LOOKUP_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ schema: schemaRef(AdminPaymentsSchema) })
  getAdminPayments(): Promise<AdminPayments> {
    return this.payments.list();
  }

  /** Who bears a lost dispute (#57, #83): once, for good, the owners told. */
  @Post('disputes/:id/decide')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle(MODERATE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminDisputeDecisionInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminBookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  async decideAdminDispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminBooking> {
    const { bookingId } = await this.payments.decide(
      user.id,
      id,
      parseOrThrow(AdminDisputeDecisionInputSchema, body),
    );
    return this.bookingsAdmin.show(bookingId);
  }

  @Get('audit')
  @ApiQuery({ name: 'action', required: false, type: String })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(AuditLogSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAuditLog(@Query() rawQuery: unknown): Promise<AuditLog> {
    return this.audit.list(parseOrThrow(AdminAuditQuerySchema, rawQuery));
  }
}
