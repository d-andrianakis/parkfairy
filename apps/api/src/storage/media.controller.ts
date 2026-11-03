import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseSchema, PHOTO_WIDTHS } from '@parkfairy/contracts';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators.js';
import { schemaRef } from '../openapi/zod-openapi.js';
import { OBJECT_STORE, type ObjectStore } from './object-store.js';
import { photoObjectKey } from './photo-pipeline.js';

const PHOTO_KEY = /^[0-9a-f]{32}$/;
const WIDTHS = new Set<string>(PHOTO_WIDTHS.map(String));
/** Far above any page's photos, but random keys are misses a CDN can't absorb. */
const MEDIA_LIMIT = { default: { limit: 1200, ttl: 60_000 } };
/** Long enough for a CDN to absorb repeats, short enough for a photo that arrives later. */
const MISSING_MAX_AGE = 'public, max-age=60';

function notFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Not Found',
    code: 'PHOTO_NOT_FOUND',
  });
}

/**
 * Listing photos. Public, and only ever `photos/`: both path parts are checked against a closed
 * set, so this route can't be pointed at proof documents. It has a limit of its own, because one
 * results page is dozens of images and the shared one would blank them; the file names are content
 * hashes, so browsers and a CDN keep them for ever and most requests never get here. The long cache
 * header goes on a file actually served and nothing else: a failed read must not be kept for a year.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(@Inject(OBJECT_STORE) private readonly store: ObjectStore) {}

  @Get('photos/:key/:width.webp')
  @Public()
  @Throttle(MEDIA_LIMIT)
  @ApiParam({ name: 'key', type: String })
  @ApiParam({ name: 'width', enum: PHOTO_WIDTHS.map(String) })
  @ApiProduces('image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ schema: schemaRef(ErrorResponseSchema) })
  async getListingPhoto(
    @Param('key') key: string,
    @Param('width') width: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!PHOTO_KEY.test(key) || !WIDTHS.has(width)) throw notFound();
    const file = await this.store.get(photoObjectKey(key, Number(width)));
    if (!file) {
      response.setHeader('Cache-Control', MISSING_MAX_AGE);
      throw notFound();
    }
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return new StreamableFile(file, { type: 'image/webp' });
  }
}
