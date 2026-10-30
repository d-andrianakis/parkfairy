import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses input with a contract schema; failures become a 400 whose messages are i18n keys. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: result.error.issues.map((issue) => issue.message),
      code: 'VALIDATION_FAILED',
    });
  }
  return result.data;
}
