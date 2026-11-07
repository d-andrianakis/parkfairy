import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
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
  ErrorResponseSchema,
  ListingHoursCopyInputSchema,
  ListingHoursExceptionsCopyInputSchema,
  ListingHoursExceptionsInputSchema,
  ListingHoursInputSchema,
  ListingLocationPatchSchema,
  ListingPhotoOrderSchema,
  ListingPhotoUpdateSchema,
  ListingPricesInputSchema,
  ListingProofPatchSchema,
  ListingSpacesInputSchema,
  ListingSubmitInputSchema,
  OwnerHoursCopySchema,
  OwnerHoursExceptionsCopySchema,
  OwnerHoursExceptionsSchema,
  OwnerListingClosuresSchema,
  OwnerListingCreatedSchema,
  OwnerOtherListingsSchema,
  OwnerListingProgressSchema,
  OwnerListingSchema,
  OwnerOnboardingSchema,
  OwnerPhotoSchema,
  OwnerProfilePatchSchema,
  OwnerProfileSchema,
  OwnerProofSchema,
  OwnerTaxInputSchema,
  PHOTO_CONTENT_TYPES,
  PHOTO_LIMITS,
  PROOF_CONTENT_TYPES,
  PROOF_KINDS,
  PROOF_LIMITS,
  ProofUploadQuerySchema,
  type OwnerHoursCopy,
  type OwnerHoursExceptions,
  type OwnerHoursExceptionsCopy,
  type OwnerListing,
  type OwnerListingClosures,
  type OwnerListingProgress,
  type OwnerOtherListings,
  type OwnerOnboarding,
  type OwnerPhoto,
  type OwnerProfile,
  type OwnerProof,
} from '@parkfairy/contracts';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { readBody } from '../storage/read-body.js';
import { UploadGate } from '../storage/upload-gate.js';
import { OwnerListingsService } from './owner-listings.service.js';
import { OwnerProfileService } from './owner-profile.service.js';

const MINUTE_MS = 60_000;
/** Uploads are the expensive route: decoding and resizing, then storage. */
const UPLOAD_LIMIT = { default: { limit: 30, ttl: MINUTE_MS } };
/** Each try at a tax number costs an encryption and says whether the format passed. */
const TAX_LIMIT = { default: { limit: 10, ttl: MINUTE_MS } };
/** A copy can write to fifty listings; the default allowance would be thousands of statements. */
const COPY_LIMIT = { default: { limit: 10, ttl: MINUTE_MS } };

const BINARY = { schema: { type: 'string', format: 'binary' } } as const;

/** A file's name, which can say whose it is: in a header, because query strings reach logs. */
function decodeFileName(header: string | undefined): string {
  try {
    return decodeURIComponent(header ?? '').slice(0, PROOF_LIMITS.fileName);
  } catch {
    return '';
  }
}

/**
 * An owner's own data. No `@Roles`: anyone with an account can list parking. Every service call
 * starts from the session's user, so an id from the URL only ever reaches that user's rows, and
 * another owner's listing is the same 404 as one that doesn't exist.
 */
@ApiTags('owner')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('owner')
export class OwnerController {
  constructor(
    private readonly profiles: OwnerProfileService,
    private readonly listings: OwnerListingsService,
    private readonly gate: UploadGate,
  ) {}

  /**
   * Takes a place for the upload, checks the listing, and only then reads the body, so nobody
   * can make the API hold a file for a listing that isn't theirs.
   */
  private async upload<T>(
    userId: string,
    id: string,
    request: Request,
    maxBytes: number,
    handle: (file: Buffer) => Promise<T>,
  ): Promise<T> {
    const leave = this.gate.admit(userId);
    try {
      await this.listings.assertEditable(userId, id);
      return await handle(await readBody(request, maxBytes));
    } finally {
      leave();
    }
  }

  @Get('onboarding')
  @ApiOkResponse({ schema: schemaRef(OwnerOnboardingSchema) })
  getOwnerOnboarding(@CurrentUser() user: AuthUser): Promise<OwnerOnboarding> {
    return this.listings.overview(user.id);
  }

  @Get('profile')
  @ApiOkResponse({ schema: schemaRef(OwnerProfileSchema) })
  getOwnerProfile(@CurrentUser() user: AuthUser): Promise<OwnerProfile> {
    return this.profiles.get(user.id);
  }

  @Patch('profile')
  @ApiBody({ schema: schemaRef(OwnerProfilePatchSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerProfileSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  updateOwnerProfile(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<OwnerProfile> {
    return this.profiles.patch(user.id, parseOrThrow(OwnerProfilePatchSchema, body));
  }

  @Put('profile/tax')
  @Throttle(TAX_LIMIT)
  @ApiBody({ schema: schemaRef(OwnerTaxInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerProfileSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveOwnerTaxDetails(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<OwnerProfile> {
    return this.profiles.saveTax(user.id, parseOrThrow(OwnerTaxInputSchema, body));
  }

  @Post('listings')
  @ApiCreatedResponse({ schema: schemaRef(OwnerListingCreatedSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  createOwnerListing(@CurrentUser() user: AuthUser): Promise<{ id: string }> {
    return this.listings.create(user.id);
  }

  @Get('listings/:id')
  @ApiOkResponse({ schema: schemaRef(OwnerListingSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getOwnerListing(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OwnerListing> {
    return this.listings.get(user.id, id);
  }

  @Get('listings/:id/hours-exceptions')
  @ApiOkResponse({ schema: schemaRef(OwnerListingClosuresSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getListingHoursExceptions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<OwnerListingClosures> {
    return this.listings.closures(user.id, id);
  }

  @Get('listings/:id/others')
  @ApiOkResponse({ schema: schemaRef(OwnerOtherListingsSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  getOtherOwnerListings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<OwnerOtherListings> {
    return this.listings.others(user.id, id);
  }

  @Delete('listings/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  deleteOwnerListing(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.listings.remove(user.id, id);
  }

  @Patch('listings/:id/location')
  @ApiBody({ schema: schemaRef(ListingLocationPatchSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    return this.listings.saveLocation(user.id, id, parseOrThrow(ListingLocationPatchSchema, body));
  }

  @Put('listings/:id/spaces')
  @ApiBody({ schema: schemaRef(ListingSpacesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingSpaces(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    return this.listings.saveSpaces(user.id, id, parseOrThrow(ListingSpacesInputSchema, body));
  }

  @Put('listings/:id/hours')
  @ApiBody({ schema: schemaRef(ListingHoursInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingHours(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    return this.listings.saveHours(user.id, id, parseOrThrow(ListingHoursInputSchema, body));
  }

  /** Replaces the weekly hours of the owner's drafts and listings sent back; see the service. */
  @Post('listings/:id/hours/copy')
  @HttpCode(200)
  @Throttle(COPY_LIMIT)
  @ApiBody({ schema: schemaRef(ListingHoursCopyInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerHoursCopySchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  copyListingHours(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerHoursCopy> {
    return this.listings.copyHours(user.id, id, parseOrThrow(ListingHoursCopyInputSchema, body));
  }

  /** Unlike the steps, open whatever the listing's status: see the service. */
  @Put('listings/:id/hours-exceptions')
  @ApiBody({ schema: schemaRef(ListingHoursExceptionsInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerHoursExceptionsSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingHoursExceptions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerHoursExceptions> {
    return this.listings.saveHoursExceptions(
      user.id,
      id,
      parseOrThrow(ListingHoursExceptionsInputSchema, body),
    );
  }

  /** Adds this listing's entries to the owner's other listings named; see the service. */
  @Post('listings/:id/hours-exceptions/copy')
  @HttpCode(200)
  @Throttle(COPY_LIMIT)
  @ApiBody({ schema: schemaRef(ListingHoursExceptionsCopyInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerHoursExceptionsCopySchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  copyListingHoursExceptions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerHoursExceptionsCopy> {
    return this.listings.copyHoursExceptions(
      user.id,
      id,
      parseOrThrow(ListingHoursExceptionsCopyInputSchema, body),
    );
  }

  @Put('listings/:id/prices')
  @ApiBody({ schema: schemaRef(ListingPricesInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingPrices(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    return this.listings.savePrices(user.id, id, parseOrThrow(ListingPricesInputSchema, body));
  }

  @Post('listings/:id/photos')
  @Throttle(UPLOAD_LIMIT)
  @ApiConsumes(...PHOTO_CONTENT_TYPES)
  @ApiBody(BINARY)
  @ApiCreatedResponse({ schema: schemaRef(OwnerPhotoSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  async uploadListingPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<OwnerPhoto> {
    return OwnerPhotoSchema.parse(
      await this.upload(user.id, id, request, PHOTO_LIMITS.maxBytes, (file) =>
        this.listings.addPhoto(user.id, id, file),
      ),
    );
  }

  @Put('listings/:id/photos/order')
  @HttpCode(204)
  @ApiBody({ schema: schemaRef(ListingPhotoOrderSchema) })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  reorderListingPhotos(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.listings.reorderPhotos(user.id, id, parseOrThrow(ListingPhotoOrderSchema, body));
  }

  @Patch('listings/:id/photos/:photoId')
  @HttpCode(204)
  @ApiBody({ schema: schemaRef(ListingPhotoUpdateSchema) })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  updateListingPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.listings.updatePhoto(
      user.id,
      id,
      photoId,
      parseOrThrow(ListingPhotoUpdateSchema, body),
    );
  }

  @Delete('listings/:id/photos/:photoId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  deleteListingPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    return this.listings.removePhoto(user.id, id, photoId);
  }

  @Post('listings/:id/proofs')
  @Throttle(UPLOAD_LIMIT)
  @ApiConsumes(...PROOF_CONTENT_TYPES)
  @ApiBody(BINARY)
  @ApiQuery({ name: 'kind', enum: PROOF_KINDS })
  @ApiHeader({ name: 'x-file-name', description: 'URI-encoded: names stay out of request logs.' })
  @ApiCreatedResponse({ schema: schemaRef(OwnerProofSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  async uploadListingProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() rawQuery: unknown,
    @Req() request: Request,
  ): Promise<OwnerProof> {
    const { kind } = parseOrThrow(ProofUploadQuerySchema, rawQuery);
    const fileName = decodeFileName(request.header('x-file-name'));
    return OwnerProofSchema.parse(
      await this.upload(user.id, id, request, PROOF_LIMITS.maxBytes, (file) =>
        this.listings.addProof(user.id, id, kind, fileName, file),
      ),
    );
  }

  /**
   * Always a download, never shown in place: the file is whatever the owner sent, and an
   * inline PDF or image on our origin is more than it needs to be.
   */
  @Get('listings/:id/proofs/:proofId')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @ApiProduces(...PROOF_CONTENT_TYPES)
  @ApiOkResponse(BINARY)
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async downloadListingProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { file, fileName, contentType } = await this.listings.proofFile(user.id, id, proofId);
    response.attachment(fileName);
    // After `attachment`, which guesses the type from the name's extension.
    response.type(contentType);
    return new StreamableFile(file, { type: contentType });
  }

  @Delete('listings/:id/proofs/:proofId')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  deleteListingProof(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('proofId') proofId: string,
  ): Promise<void> {
    return this.listings.removeProof(user.id, id, proofId);
  }

  @Patch('listings/:id/proof-details')
  @ApiBody({ schema: schemaRef(ListingProofPatchSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  saveListingProofDetails(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    return this.listings.saveProofDetails(user.id, id, parseOrThrow(ListingProofPatchSchema, body));
  }

  @Post('listings/:id/submit')
  @HttpCode(200)
  @ApiBody({ schema: schemaRef(ListingSubmitInputSchema) })
  @ApiOkResponse({ schema: schemaRef(OwnerListingProgressSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiConflictResponse({ schema: schemaRef(ErrorResponseSchema) })
  submitOwnerListing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OwnerListingProgress> {
    parseOrThrow(ListingSubmitInputSchema, body);
    return this.listings.submit(user.id, id);
  }
}
