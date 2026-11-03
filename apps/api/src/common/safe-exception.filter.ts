import {
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

interface Described {
  name?: string;
  stack?: string;
  code?: string;
  cause?: { code?: string };
}

/** Frames only: a stack's first line repeats the message, parameters and all. */
const framesOf = (stack: string | undefined) => stack?.split('\n').slice(1, 6).join('\n');

/**
 * Whatever isn't an HTTP error is logged by name and code, never by message. Drizzle's messages
 * quote the query's parameters, so Nest's default would put an owner's name, phone and address in
 * the logs whenever a save hit a database error. Answers stay the same generic 500.
 */
@Catch()
export class SafeExceptionFilter extends BaseExceptionFilter {
  private readonly errors = new Logger('UnhandledError');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    const { name, code, cause, stack } = (exception ?? {}) as Described;
    this.errors.error({ name, code: cause?.code ?? code, stack: framesOf(stack) });
    super.catch(new InternalServerErrorException(), host);
  }
}
