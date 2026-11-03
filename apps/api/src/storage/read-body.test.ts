import { Readable } from 'node:stream';
import { type HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readBody } from './read-body.js';

function requestWith(chunks: Buffer[], contentLength?: number): Request {
  const stream = Readable.from(chunks) as unknown as Request;
  (stream as { headers: Record<string, string> }).headers =
    contentLength === undefined ? {} : { 'content-length': String(contentLength) };
  return stream;
}

const status = async (request: Request, limit: number) => {
  try {
    await readBody(request, limit);
    return 'read';
  } catch (error) {
    return (error as HttpException).getStatus();
  }
};

describe('readBody', () => {
  it('reads a body within the limit', async () => {
    const body = await readBody(requestWith([Buffer.from('ab'), Buffer.from('cd')], 4), 4);
    expect(body.toString()).toBe('abcd');
  });

  it('refuses a declared size over the limit, after reading what was sent', async () => {
    const request = requestWith([Buffer.alloc(11)], 11);
    expect(await status(request, 10)).toBe(413);
    expect((request as unknown as Readable).readableEnded).toBe(true);
  });

  it('refuses a declared size far over the limit without reading it', async () => {
    const request = requestWith([Buffer.alloc(100)], 100);
    expect(await status(request, 10)).toBe(413);
    expect((request as unknown as Readable).readableDidRead).toBe(false);
  });

  it('holds the limit when the declared size lies', async () => {
    expect(await status(requestWith([Buffer.alloc(6), Buffer.alloc(6)], 5), 10)).toBe(413);
  });

  it('holds the limit when no size is declared', async () => {
    expect(await status(requestWith([Buffer.alloc(6), Buffer.alloc(6)]), 10)).toBe(413);
  });
});
