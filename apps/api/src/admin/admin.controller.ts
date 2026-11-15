import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  ForbiddenException,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@parkfairy/auth';
import {
  AdminAuditQuerySchema,
  AdminChangesInputSchema,
  AdminListingReviewSchema,
  AdminQueueQuerySchema,
  AdminQueueSchema,
  AuditLogSchema,
  ErrorResponseSchema,
  PROOF_CONTENT_TYPES,
  type AdminListingReview,
  type AdminQueue,
  type AuditLog,
} from '@parkfairy/contracts';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { AccountThrottlerGuard } from '../rate-limit/account-throttler.guard.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminListingsService } from './admin-listings.service.js';

const MINUTE_MS = 60_000;
/** Decisions and proofs opened: a person's pace, not a script's. */
const DECIDE_LIMIT = { default: { limit: 30, ttl: MINUTE_MS } };
const BINARY = { schema: { type: 'string', format: 'binary' } } as const;

/**
 * What staff do (5.2, #66–#68). Platform staff only (`users.role = 'admin'`) and, for an admin, with
 * a second factor on: the guard answers 403 `MFA_REQUIRED` otherwise. Every action that changes
 * something, and every proof opened, is a line in the audit log.
 */
@ApiTags('admin')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly listings: AdminListingsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('listings')
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(AdminQueueSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminQueue(@Query() rawQuery: unknown): Promise<AdminQueue> {
    return this.listings.queue(parseOrThrow(AdminQueueQuerySchema, rawQuery));
  }

  @Get('listings/:id')
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<AdminListingReview> {
    return this.listings.review(user.id, id);
  }

  /** Always a download, never shown in place, as for the owner; opening one is logged. */
  @Get('listings/:id/proofs/:proofId')
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @ApiProduces(...PROOF_CONTENT_TYPES)
  @ApiOkResponse(BINARY)
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async downloadAdminProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Headers('sec-fetch-site') fetchSite: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    // A GET that writes a line of the log: not from a link on another site, which a browser says
    // (`Sec-Fetch-Site`) and cookies marked Lax would otherwise let through as a navigation.
    if (fetchSite === 'cross-site') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'FORBIDDEN',
        code: 'FORBIDDEN',
      });
    }
    const { file, fileName, contentType } = await this.listings.proofFile(user.id, id, proofId);
    response.attachment(fileName);
    // After `attachment`, which guesses the type from the name's extension.
    response.type(contentType);
    return new StreamableFile(file, { type: contentType });
  }

  @Post('listings/:id/approve')
  @HttpCode(200)
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  approveAdminListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<AdminListingReview> {
    return this.listings.approve(user.id, id);
  }

  @Post('listings/:id/request-changes')
  @HttpCode(200)
  @Throttle(DECIDE_LIMIT)
  @UseGuards(AccountThrottlerGuard)
  @ApiBody({ schema: schemaRef(AdminChangesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(AdminListingReviewSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  requestAdminListingChanges(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminListingReview> {
    return this.listings.requestChanges(user.id, id, parseOrThrow(AdminChangesInputSchema, body));
  }

  @Get('audit')
  @ApiQuery({ name: 'action', required: false, type: String })
  @ApiQuery({ name: 'after', required: false, type: String })
  @ApiOkResponse({ schema: schemaRef(AuditLogSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  getAuditLog(@Query() rawQuery: unknown): Promise<AuditLog> {
    return this.audit.list(parseOrThrow(AdminAuditQuerySchema, rawQuery));
  }
}
