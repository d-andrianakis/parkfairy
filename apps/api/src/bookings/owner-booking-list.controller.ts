import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  type OwnerBookingList,
  OwnerBookingListQuerySchema,
  OwnerBookingListSchema,
} from '@parkfairy/contracts';

import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { OwnerBookingListService } from './owner-booking-list.service.js';

/** Paging through a list is a person's pace: a page a second, per account (managers read too). */
const LIST_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** The bookings of every listing the signed-in account runs, a page at a time (5.1). */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/bookings')
export class OwnerBookingListController {
  constructor(private readonly list: OwnerBookingListService) {}

  @Get()
  @Throttle(LIST_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiQuery({ name: 'status', required: false, enum: ['upcoming', 'past', 'cancelled'] })
  @ApiQuery({ name: 'listing', required: false, type: String })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-11-30' })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiQuery({ name: 'before', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(OwnerBookingListSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  listOwnerBookings(
    @CurrentUser() user: AuthUser,
    @Query() rawQuery: unknown,
  ): Promise<OwnerBookingList> {
    return this.list.bookings(user.id, parseOrThrow(OwnerBookingListQuerySchema, rawQuery));
  }
}
