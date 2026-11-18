import { Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  type FavouriteList,
  FavouriteListSchema,
  type FavouriteState,
  FavouriteStateSchema,
  isListingSlug,
} from '@parkfairy/contracts';

import { CurrentUser } from '../auth/auth.decorators.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { listingNotFound } from '../owner/owner.errors.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { FavouritesService } from './favourites.service.js';

/** Starring and unstarring listings: a person's pace, per account and per address. */
const CHANGE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** The signed-in driver's favourite listings (5A.2): never `@Public()`, always their own. */
@ApiTags('favourites')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get()
  @ApiOkResponse({ schema: schemaRef(FavouriteListSchema) })
  getMyFavourites(@CurrentUser() user: AuthUser): Promise<FavouriteList> {
    return this.favourites.list(user.id);
  }

  @Get(':slug')
  @ApiOkResponse({ schema: schemaRef(FavouriteStateSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  isMyFavourite(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
  ): Promise<FavouriteState> {
    return this.favourites.state(user.id, checked(slug));
  }

  @Put(':slug')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(FavouriteStateSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  favouriteListing(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
  ): Promise<FavouriteState> {
    return this.favourites.add(user.id, checked(slug));
  }

  @Delete(':slug')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(FavouriteStateSchema) })
  unfavouriteListing(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
  ): Promise<FavouriteState> {
    return this.favourites.remove(user.id, checked(slug));
  }
}

/** A slug that can't be one is a listing that doesn't exist, without asking the database. */
function checked(slug: string): string {
  if (!isListingSlug(slug)) throw listingNotFound();
  return slug;
}
