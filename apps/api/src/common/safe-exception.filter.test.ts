import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeExceptionFilter } from './safe-exception.filter.js';

const reply = vi.fn();
const adapter = { reply, isHeadersSent: () => false, end: vi.fn() };
const host = { getArgByIndex: () => ({}), getType: () => 'http' } as unknown as ArgumentsHost;

function filter() {
  const instance = new SafeExceptionFilter();
  (instance as unknown as { httpAdapterHost: HttpAdapterHost }).httpAdapterHost = {
    httpAdapter: adapter,
  } as unknown as HttpAdapterHost;
  return instance;
}

afterEach(() => {
  vi.restoreAllMocks();
  reply.mockClear();
});

describe('SafeExceptionFilter', () => {
  it('keeps a database error’s parameters out of the logs', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = Object.assign(
      new Error('Failed query: update owner_profiles params: Μαρία,+30 210 123 4567,Ερμού 1'),
      { name: 'DrizzleQueryError', cause: { code: '22021' } },
    );

    filter().catch(error, host);

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('Μαρία');
    expect(logged).not.toContain('210 123');
    expect(logged).toContain('DrizzleQueryError');
    expect(logged).toContain('22021');
  });

  it('answers a generic 500, with nothing from the error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter().catch(new Error('secret detail'), host);
    const [call] = reply.mock.calls as unknown[][];
    expect(call?.[2]).toBe(500);
    expect(JSON.stringify(call?.[1])).not.toContain('secret detail');
  });

  it('leaves HTTP errors as they are, unlogged', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter().catch(new BadRequestException({ code: 'VALIDATION_FAILED' }), host);
    expect(log).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[2]).toBe(400);
  });

  it('copes with something thrown that isn’t an error at all', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter().catch(undefined, host);
    expect(reply.mock.calls[0]?.[2]).toBe(500);
  });
});
