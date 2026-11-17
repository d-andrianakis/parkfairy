import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';
import { bodyIsAllowed, isAllowedAuthRequest } from '@/lib/auth-routes';

const handler = toNextJsHandler((request) => getAuth().handler(request));

const refuse = (status: number) => Promise.resolve(new Response(null, { status }));

/** Only the few endpoints staff need; a plain 404 for the rest, as if they did not exist. */
function onlyAllowed(serve: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    if (!isAllowedAuthRequest(request.method, new URL(request.url).pathname)) return refuse(404);
    // The second step's remember-this-device option: this app never sends it, so nobody may.
    if (request.url.includes('/two-factor/')) {
      const parsed: unknown = await request
        .clone()
        .json()
        .catch(() => null);
      if (!bodyIsAllowed(parsed)) return refuse(400);
    }
    return serve(request);
  };
}

export const GET = onlyAllowed(handler.GET);
export const POST = onlyAllowed(handler.POST);
export const PATCH = onlyAllowed(handler.PATCH);
export const PUT = onlyAllowed(handler.PUT);
export const DELETE = onlyAllowed(handler.DELETE);
