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
  OwnerEarningsQuerySchema,
  OwnerEarningsSchema,
  type OwnerEarnings,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { OwnerEarningsService } from './owner-earnings.service.js';

/** What the signed-in owner has earned: their own part of each booking, after commission. */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner/earnings')
export class OwnerEarningsController {
  constructor(private readonly earnings: OwnerEarningsService) {}

  @Get()
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(OwnerEarningsSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getEarnings(@CurrentUser() user: AuthUser, @Query() rawQuery: unknown): Promise<OwnerEarnings> {
    return this.earnings.earnings(user.id, parseOrThrow(OwnerEarningsQuerySchema, rawQuery));
  }
}
