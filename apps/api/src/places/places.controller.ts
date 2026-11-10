import { Controller, Get, Header, NotFoundException, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ErrorResponseSchema,
  PlaceListSchema,
  PlaceRetrieveQuerySchema,
  PlaceSchema,
  PlaceSearchQuerySchema,
  PlaceSuggestionsSchema,
  PlaceSuggestQuerySchema,
  SUPPORTED_LOCALES,
  type Place,
  type PlaceList,
  type PlaceSuggestions,
} from '@parkfairy/contracts';
import { Public } from '../auth/auth.decorators.js';
import { parseOrThrow } from '../common/validation.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { PlacesVisitorGuard } from './places-visitor.guard.js';
import { PlacesService } from './places.service.js';

const MINUTE_MS = 60_000;
/** Typing asks every few letters: a long address is a dozen calls, a few addresses a minute. */
const SUGGEST_LIMIT = { default: { limit: 60, ttl: MINUTE_MS } };
/** One per address picked or typed; each is a billed call or ends a billed session. */
const LOOKUP_LIMIT = { default: { limit: 20, ttl: MINUTE_MS } };
/** Mapbox's results are for the moment only: no shared cache keeps them, nor the browser's. */
const NO_STORE = ['Cache-Control', 'no-store'] as const;

const SESSION_DOC = 'A UUID per search session, from the first suggestion to the pick.';

/**
 * Address search for the search form (decision #40), public like search itself. The browser never
 * talks to Mapbox: the token stays here, and every billed call passes these limits, a cap per
 * visitor and hour across the three routes, and the site's hourly budget. Other sites' pages get
 * nothing (`PlacesVisitorGuard`).
 */
@ApiTags('places')
@UseGuards(PlacesVisitorGuard)
@ApiForbiddenResponse({ schema: schemaRef(ErrorResponseSchema) })
@ApiTooManyRequestsResponse({ schema: schemaRef(ErrorResponseSchema) })
@ApiServiceUnavailableResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('suggestions')
  @Public()
  @Throttle(SUGGEST_LIMIT)
  @Header(...NO_STORE)
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiQuery({ name: 'session', required: true, type: String, description: SESSION_DOC })
  @ApiQuery({ name: 'locale', required: true, enum: SUPPORTED_LOCALES })
  @ApiOkResponse({ schema: schemaRef(PlaceSuggestionsSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  async getPlaceSuggestions(@Query() rawQuery: unknown): Promise<PlaceSuggestions> {
    const query = parseOrThrow(PlaceSuggestQuerySchema, rawQuery);
    return PlaceSuggestionsSchema.parse({ suggestions: await this.places.suggest(query) });
  }

  /** The picked suggestion's position; ends the session Mapbox bills. */
  @Get('retrieve')
  @Public()
  @Throttle(LOOKUP_LIMIT)
  @Header(...NO_STORE)
  @ApiQuery({ name: 'id', required: true, type: String })
  @ApiQuery({ name: 'session', required: true, type: String, description: SESSION_DOC })
  @ApiQuery({ name: 'locale', required: true, enum: SUPPORTED_LOCALES })
  @ApiOkResponse({ schema: schemaRef(PlaceSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async retrievePlace(@Query() rawQuery: unknown): Promise<Place> {
    const place = await this.places.retrieve(parseOrThrow(PlaceRetrieveQuerySchema, rawQuery));
    if (!place) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Not Found',
        code: 'PLACE_NOT_FOUND',
      });
    }
    return PlaceSchema.parse(place);
  }

  /** Text never picked from the suggestions, looked up once; the best match first. */
  @Get()
  @Public()
  @Throttle(LOOKUP_LIMIT)
  @Header(...NO_STORE)
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiQuery({ name: 'locale', required: true, enum: SUPPORTED_LOCALES })
  @ApiOkResponse({ schema: schemaRef(PlaceListSchema) })
  @ApiBadRequestResponse({ schema: schemaRef(ErrorResponseSchema) })
  async findPlaces(@Query() rawQuery: unknown): Promise<PlaceList> {
    const query = parseOrThrow(PlaceSearchQuerySchema, rawQuery);
    return PlaceListSchema.parse({ places: await this.places.find(query) });
  }
}
