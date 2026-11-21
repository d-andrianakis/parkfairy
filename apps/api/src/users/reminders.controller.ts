import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  type ReminderPreferences,
  ReminderPreferencesInputSchema,
  ReminderPreferencesSchema,
} from '@parkfairy/contracts';

import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { RemindersService } from './reminders.service.js';

/** A switch pressed by a person: a handful a minute is plenty. */
const CHANGE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/** The signed-in driver's reminder choice (5A.3): their own row, taken from the session only. */
@ApiTags('users')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('me/reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOkResponse({ schema: schemaRef(ReminderPreferencesSchema) })
  getMyReminders(@CurrentUser() user: AuthUser): Promise<ReminderPreferences> {
    return this.reminders.get(user.id);
  }

  @Put()
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(ReminderPreferencesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(ReminderPreferencesSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  setMyReminders(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<ReminderPreferences> {
    return this.reminders.set(user.id, parseOrThrow(ReminderPreferencesInputSchema, body));
  }
}
