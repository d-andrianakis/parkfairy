import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  ErrorResponseSchema,
  InviteAcceptedSchema,
  InvitePreviewSchema,
  InviteTokenInputSchema,
  ListingInviteInputSchema,
  ListingOwnersSchema,
  ListingSharesInputSchema,
  type InviteAccepted,
  type InvitePreview,
  type ListingOwners,
} from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { ListingOwnersService } from './listing-owners.service.js';

const MINUTE_MS = 60_000;
/**
 * Invites send email to addresses that may be no one's account: a few a minute per account, and a
 * listing never has more than ten owners and open invites together (LISTING_OWNERS_MAX).
 */
const INVITE_LIMIT = { default: { limit: 10, ttl: MINUTE_MS } };
/** Changes to the owners: a person's pace, not a script's. */
const CHANGE_LIMIT = { default: { limit: 20, ttl: MINUTE_MS } };
/** An invite's token tried: few, so guessing one is hopeless even before its 256 bits. */
const TOKEN_LIMIT = { default: { limit: 10, ttl: MINUTE_MS } };

const reader = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified,
});

/**
 * Co-ownership of a listing (#53–#56): its owners and their shares, invites to join, and the
 * invite page. Every route answers for the signed-in account only; another owner's listing is
 * the same 404 as one that doesn't exist.
 */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner')
export class ListingOwnersController {
  constructor(private readonly owners: ListingOwnersService) {}

  @Get('listings/:id/owners')
  @ApiOkResponse({ schema: schemaRef(ListingOwnersSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getListingOwners(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ListingOwners> {
    return this.owners.list(user.id, id);
  }

  @Post('listings/:id/invites')
  @HttpCode(200)
  @Throttle(INVITE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(ListingInviteInputSchema) })
  @ApiOkResponse({ schema: schemaRef(ListingOwnersSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  inviteListingOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ListingOwners> {
    return this.owners.invite(user.id, id, parseOrThrow(ListingInviteInputSchema, body));
  }

  @Delete('listings/:id/invites/:inviteId')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(ListingOwnersSchema) })
  @ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  withdrawListingInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
  ): Promise<ListingOwners> {
    return this.owners.withdraw(user.id, id, inviteId);
  }

  @Put('listings/:id/shares')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(ListingSharesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(ListingOwnersSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  setListingShares(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ListingOwners> {
    return this.owners.setShares(user.id, id, parseOrThrow(ListingSharesInputSchema, body));
  }

  @Delete('listings/:id/owners/:ownerId')
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(ListingOwnersSchema) })
  @ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  removeListingOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('ownerId') ownerId: string,
  ): Promise<ListingOwners> {
    return this.owners.removeOwner(user.id, id, ownerId);
  }

  @Post('listings/:id/leave')
  @HttpCode(204)
  @Throttle(CHANGE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  leaveListing(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.owners.leave(user.id, id);
  }

  /** The invite page's look before accepting; the token in the body, never in a logged URL. */
  @Post('invites/preview')
  @HttpCode(200)
  @Throttle(TOKEN_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(InviteTokenInputSchema) })
  @ApiOkResponse({ schema: schemaRef(InvitePreviewSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  previewListingInvite(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<InvitePreview> {
    return this.owners.preview(reader(user), parseOrThrow(InviteTokenInputSchema, body).token);
  }

  @Post('invites/accept')
  @HttpCode(200)
  @Throttle(TOKEN_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(InviteTokenInputSchema) })
  @ApiOkResponse({ schema: schemaRef(InviteAcceptedSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  acceptListingInvite(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<InviteAccepted> {
    return this.owners.accept(reader(user), parseOrThrow(InviteTokenInputSchema, body).token);
  }
}
