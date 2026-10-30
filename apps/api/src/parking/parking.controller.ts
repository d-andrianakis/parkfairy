import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AREA_IDS,
  ErrorResponseSchema,
  FeaturedParkingResponseSchema,
  isListingSlug,
  ParkingListingDetailSchema,
  ParkingListingQuerySchema,
  ParkingSearchQuerySchema,
  ParkingSearchResponseSchema,
  type FeaturedParkingResponse,
  type ParkingListingDetail,
  type ParkingSearchResponse,
} from '@parkfairy/contracts';
import { Public } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { ParkingService } from './parking.service.js';

const WINDOW_DOC = 'Instant (UTC, ISO 8601) on a half hour.';

/**
 * Public catalogue: anyone may browse and search published listings without an account.
 * `@Public()` sits on each route, not the class, so a route added later is protected unless
 * it opts out explicitly.
 */
@ApiTags('parking')
@Controller('parking')
export class ParkingController {
  constructor(private readonly parking: ParkingService) {}

  @Get('featured')
  @Public()
  @ApiOkResponse({ schema: schemaRef(FeaturedParkingResponseSchema) })
  async getFeaturedParking(): Promise<FeaturedParkingResponse> {
    return FeaturedParkingResponseSchema.parse({ listings: await this.parking.featured() });
  }

  @Get('search')
  @Public()
  @ApiQuery({ name: 'area', required: false, enum: AREA_IDS })
  @ApiQuery({ name: 'latitude', required: false, type: Number })
  @ApiQuery({ name: 'longitude', required: false, type: Number })
  @ApiQuery({ name: 'start', required: true, type: String, description: WINDOW_DOC })
  @ApiQuery({ name: 'end', required: true, type: String, description: WINDOW_DOC })
  @ApiOkResponse({ schema: schemaRef(ParkingSearchResponseSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  async searchParking(@Query() rawQuery: unknown): Promise<ParkingSearchResponse> {
    const query = parseOrThrow(ParkingSearchQuerySchema, rawQuery);
    return ParkingSearchResponseSchema.parse({
      start: new Date(query.start).toISOString(),
      end: new Date(query.end).toISOString(),
      results: await this.parking.search(query),
    });
  }

  @Get(':slug')
  @Public()
  @ApiParam({ name: 'slug', type: String })
  @ApiQuery({ name: 'start', required: false, type: String, description: WINDOW_DOC })
  @ApiQuery({ name: 'end', required: false, type: String, description: WINDOW_DOC })
  @ApiOkResponse({ schema: schemaRef(ParkingListingDetailSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async getParkingListing(
    @Param('slug') slug: string,
    @Query() rawQuery: unknown,
  ): Promise<ParkingListingDetail> {
    const query = parseOrThrow(ParkingListingQuerySchema, rawQuery);
    const window =
      query.start && query.end
        ? { start: new Date(query.start), end: new Date(query.end) }
        : undefined;
    const listing = isListingSlug(slug) ? await this.parking.findBySlug(slug, window) : null;
    if (!listing) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found',
        code: 'LISTING_NOT_FOUND',
      });
    }
    return listing;
  }
}
