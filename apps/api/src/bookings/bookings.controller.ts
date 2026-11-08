import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  BOOKING_LISTS,
  BookingCancelInputSchema,
  BookingConfirmInputSchema,
  BookingHoldInputSchema,
  BookingListQuerySchema,
  BookingListSchema,
  BookingSchema,
  ErrorResponseSchema,
  type Booking,
  type BookingList,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { BookingsService } from './bookings.service.js';

const MINUTE_MS = 60_000;
/**
 * A hold takes a space from everyone else for ten minutes: a driver needs a few (another space,
 * another time), not hundreds. Confirming is a step after one, so it gets the same allowance.
 */
const HOLD_LIMIT = { default: { limit: 10, ttl: MINUTE_MS } };

/**
 * A driver's bookings. Booking needs an account (decision #8), so nothing here is `@Public()`, and
 * every call reaches only the session user's own bookings.
 */
@ApiTags('bookings')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Holds the space for ten minutes; `SPACE_TAKEN` when another driver got there first. */
  @Post()
  @Throttle(HOLD_LIMIT)
  @ApiBody({ schema: schemaRef(BookingHoldInputSchema) })
  @ApiCreatedResponse({ schema: schemaRef(BookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  holdParkingSpace(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<Booking> {
    return this.bookings.hold(user.id, parseOrThrow(BookingHoldInputSchema, body));
  }

  @Get()
  @ApiQuery({ name: 'when', required: false, enum: BOOKING_LISTS })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiOkResponse({ schema: schemaRef(BookingListSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getMyBookings(@CurrentUser() user: AuthUser, @Query() rawQuery: unknown): Promise<BookingList> {
    return this.bookings.list(user.id, parseOrThrow(BookingListQuerySchema, rawQuery));
  }

  @Get(':id')
  @ApiOkResponse({ schema: schemaRef(BookingSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getMyBooking(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Booking> {
    return this.bookings.get(user.id, id);
  }

  /** Until payments (Phase 4) this confirms without one, on a local run only (decision #33). */
  @Post(':id/confirm')
  @HttpCode(200)
  @Throttle(HOLD_LIMIT)
  @ApiBody({ schema: schemaRef(BookingConfirmInputSchema) })
  @ApiOkResponse({ schema: schemaRef(BookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  confirmMyBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Booking> {
    return this.bookings.confirm(user.id, id, parseOrThrow(BookingConfirmInputSchema, body));
  }

  /**
   * Keeps a running hold for another ten minutes (WCAG 2.2.1: a time limit that can be extended);
   * `HOLD_LIMIT_REACHED` after ten times, `BOOKING_NOT_ACTIVE` once it has run out.
   */
  @Post(':id/extend')
  @HttpCode(200)
  @Throttle(HOLD_LIMIT)
  @ApiOkResponse({ schema: schemaRef(BookingSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  extendMyHold(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Booking> {
    return this.bookings.extend(user.id, id);
  }

  /**
   * Lets a hold go, or calls off a booking that hasn't started, refunded by its policy;
   * `REFUND_CHANGED` when that is now less than the driver was shown.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiBody({ schema: schemaRef(BookingCancelInputSchema), required: false })
  @ApiOkResponse({ schema: schemaRef(BookingSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  cancelMyBooking(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Booking> {
    return this.bookings.cancel(user.id, id, parseOrThrow(BookingCancelInputSchema, body ?? {}));
  }
}
