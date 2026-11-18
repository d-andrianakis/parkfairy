import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  SavedVehicleInputSchema,
  type SavedVehicleList,
  SavedVehicleListSchema,
} from '@parkfairy/contracts';

import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { VehiclesService } from './vehicles.service.js';

/** Saving, changing and forgetting a car: a person's pace, per account and per address. */
const CHANGE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * The signed-in driver's saved vehicles (5A.2). Nothing here is `@Public()`, and every call reaches
 * the session user's own rows; each change answers with the whole list.
 */
@ApiTags('vehicles')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOkResponse({ schema: schemaRef(SavedVehicleListSchema) })
  getMyVehicles(@CurrentUser() user: AuthUser): Promise<SavedVehicleList> {
    return this.vehicles.list(user.id);
  }

  /** `VEHICLE_EXISTS` for a plate saved already, `VEHICLE_LIMIT_REACHED` past ten. */
  @Post()
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(SavedVehicleInputSchema) })
  @ApiCreatedResponse({ schema: schemaRef(SavedVehicleListSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveMyVehicle(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<SavedVehicleList> {
    return this.vehicles.create(user.id, parseOrThrow(SavedVehicleInputSchema, body));
  }

  @Put(':id')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(SavedVehicleInputSchema) })
  @ApiOkResponse({ schema: schemaRef(SavedVehicleListSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  changeMyVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SavedVehicleList> {
    return this.vehicles.update(user.id, id, parseOrThrow(SavedVehicleInputSchema, body));
  }

  @Delete(':id')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(SavedVehicleListSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  forgetMyVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<SavedVehicleList> {
    return this.vehicles.remove(user.id, id);
  }
}
