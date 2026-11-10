import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  OwnerBookingsQuerySchema,
  OwnerListingBookingsSchema,
  type OwnerListingBookings,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { BookingsService } from './bookings.service.js';

/**
 * The bookings of an owner's listing (decision #34). As in the rest of `/owner`, another owner's
 * listing is the same 404 as one that doesn't exist.
 */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/listings')
export class OwnerBookingsController {
  constructor(private readonly bookings: BookingsService) {}

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
}
