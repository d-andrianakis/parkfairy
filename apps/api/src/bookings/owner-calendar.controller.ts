import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  OwnerCalendarQuerySchema,
  OwnerCalendarSchema,
  type OwnerCalendar,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { OwnerCalendarService } from './owner-calendar.service.js';

/** The confirmed bookings of the signed-in owner's listings, a month at a time. */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/calendar')
export class OwnerCalendarController {
  constructor(private readonly calendar: OwnerCalendarService) {}

  @Get()
  @ApiQuery({ name: 'month', required: false, type: String, example: '2026-11' })
  @ApiQuery({ name: 'listing', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(OwnerCalendarSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getCalendar(@CurrentUser() user: AuthUser, @Query() rawQuery: unknown): Promise<OwnerCalendar> {
    return this.calendar.calendar(user.id, parseOrThrow(OwnerCalendarQuerySchema, rawQuery));
  }
}
