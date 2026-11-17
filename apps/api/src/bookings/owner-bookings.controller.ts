import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  OverstayReportInputSchema,
  OwnerBookingsQuerySchema,
  type OwnerListingBookings,
  OwnerListingBookingsSchema,
  type OwnerOverstay,
  OwnerOverstaySchema,
} from '@parkfairy/contracts';

import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { BookingsService } from './bookings.service.js';
import { OverstaysService } from './overstays.service.js';

/** Calling bookings off, per account: closing a busy day takes many, a script's loop takes more. */
const CANCEL_LIMIT = { default: { limit: 60, ttl: 60_000 } };
/** Reporting a car left past its stay: a person's pace, per account. */
const REPORT_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * The bookings of an owner's listing (decision #34). As in the rest of `/owner`, another owner's
 * listing is the same 404 as one that doesn't exist.
 */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/listings')
export class OwnerBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly overstays: OverstaysService,
  ) {}

  @Get(':id/bookings')
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'before', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(OwnerListingBookingsSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getListingBookings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() rawQuery: unknown,
  ): Promise<OwnerListingBookings> {
    return this.bookings.listingBookings(
      user.id,
      id,
      parseOrThrow(OwnerBookingsQuerySchema, rawQuery),
    );
  }

  /** Calls the booking off, the driver refunded in full; `BOOKING_STARTED` once it has begun. */
  @Post(':id/bookings/:bookingId/cancel')
  // Each is a refund and the owners' shares gone: a person's pace, per account (managers act too).
  @Throttle(CANCEL_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  cancelListingBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('bookingId') bookingId: string,
  ): Promise<void> {
    return this.bookings.cancelForOwner(user.id, id, bookingId);
  }

  /**
   * Says a car stayed past the booking (5.2c4, #11, #76): once the stay is over and within two
   * weeks of its end. Staff are told by their queue; the driver is not, and nothing is charged.
   */
  @Post(':id/bookings/:bookingId/overstay')
  @Throttle(REPORT_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(OverstayReportInputSchema) })
  @ApiCreatedResponse({ schema: schemaRef(OwnerOverstaySchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  reportOverstay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<OwnerOverstay> {
    return this.overstays.report(
      user.id,
      id,
      bookingId,
      parseOrThrow(OverstayReportInputSchema, body),
    );
  }
}
