import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Public } from '../auth/auth.decorators.js';
import { NoStoreInterceptor } from './no-store.interceptor.js';

class Routes {
  mine(this: void) {}
  @Public()
  open(this: void) {}
}

function contextFor(handler: () => void) {
  const setHeader = vi.fn();
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const next: CallHandler = { handle: () => of('answer') };
const interceptor = new NoStoreInterceptor(new Reflector());

describe('NoStoreInterceptor', () => {
  it('keeps answers that need a session out of shared caches', () => {
    const { context, setHeader } = contextFor(Routes.prototype.mine);
    interceptor.intercept(context, next);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('leaves public answers to their own caching', () => {
    const { context, setHeader } = contextFor(Routes.prototype.open);
    interceptor.intercept(context, next);
    expect(setHeader).not.toHaveBeenCalled();
  });
});
