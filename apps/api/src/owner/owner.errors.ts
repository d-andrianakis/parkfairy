import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Also what another owner's listing answers: its existence is none of their business. */
export function listingNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Not Found',
    code: 'LISTING_NOT_FOUND',
  });
}

export function conflict(code: string, extra: Record<string, unknown> = {}): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: code,
    code,
    ...extra,
  });
}

export function badUpload(code: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: code,
    code,
  });
}
