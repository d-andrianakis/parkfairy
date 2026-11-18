import { ConflictException, NotFoundException } from '@nestjs/common';

/** Another driver's vehicle answers as one that doesn't exist: its existence is none of their business. */
export function vehicleNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    message: 'Not Found',
    code: 'VEHICLE_NOT_FOUND',
  });
}

export function conflictCode(code: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', message: code, code });
}

/** A Postgres error by code and constraint, through Drizzle's wrapper. */
export function violates(error: unknown, code: string, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const found = cause as { code?: string; constraint?: string };
  return found.code === code && found.constraint === constraint;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
