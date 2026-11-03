import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

/** How far past the limit an upload is read and thrown away, so its sender gets the answer. */
const DRAIN_FACTOR = 2;
/** Node's own request timeout is 5 minutes, which would let a stalled upload hold 10 MB. */
const READ_TIMEOUT_MS = 120_000;

function tooLarge(): HttpException {
  return new HttpException(
    {
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'FILE_TOO_LARGE',
      code: 'FILE_TOO_LARGE',
    },
    413,
  );
}

/**
 * Answering while the browser is still sending resets the connection, and the owner would see a
 * network failure instead of "too large". So a file a little over the limit is read to the end
 * and discarded; anything far over it is cut off, which the page's own size check makes rare.
 */
async function discard(request: Request, limit: number): Promise<void> {
  let received = 0;
  for await (const chunk of request) {
    received += (chunk as Buffer).length;
    if (received > limit) break;
  }
}

/**
 * Reads an upload inside the route. Deliberately not a body parser: those run before the guards,
 * so anyone could make the API buffer megabytes without an account. Here the rate limit, the
 * origin check and the session have already passed. The limit holds even if `Content-Length`
 * lies.
 */
export async function readBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (declared <= maxBytes * DRAIN_FACTOR) await discard(request, maxBytes * DRAIN_FACTOR);
    throw tooLarge();
  }
  const stalled = setTimeout(() => request.destroy(), READ_TIMEOUT_MS);
  try {
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      received += buffer.length;
      if (received > maxBytes) throw tooLarge();
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, received);
  } finally {
    clearTimeout(stalled);
  }
}
