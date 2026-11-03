import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogs } from '@/test/render';
import { attempt, uploadFile, useOwnerError } from './owner-client';

vi.mock('@parkfairy/api-client', () => ({ client: { setConfig: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="el" messages={catalogs.el} timeZone="Europe/Athens">
    {children}
  </NextIntlClientProvider>
);

describe('attempt', () => {
  it('passes on what the API answered', async () => {
    const outcome = await attempt(() =>
      Promise.resolve({ data: { id: 'a' }, response: new Response(null, { status: 200 }) }),
    );
    expect(outcome).toEqual({ ok: true, data: { id: 'a' } });
  });

  it('turns a refusal into a failure', async () => {
    const outcome = await attempt(() =>
      Promise.resolve({
        error: { code: 'LISTING_LOCKED' },
        response: new Response(null, { status: 409 }),
      }),
    );
    expect(outcome).toEqual({ ok: false, failure: { code: 'LISTING_LOCKED' } });
  });

  it('treats a failed status with no body as a failure too', async () => {
    const outcome = await attempt(() =>
      Promise.resolve({ response: new Response(null, { status: 500 }) }),
    );
    expect(outcome.ok).toBe(false);
  });

  it('turns a network failure into the same answer', async () => {
    const outcome = await attempt(() => Promise.reject(new Error('offline')));
    expect(outcome).toEqual({ ok: false, failure: {} });
  });
});

describe('useOwnerError', () => {
  const translate = () => renderHook(() => useOwnerError(), { wrapper }).result.current;

  it('translates a known code', () => {
    expect(translate()({ code: 'PHOTO_DUPLICATE' })).toBe(catalogs.el.Owner.errors.PHOTO_DUPLICATE);
  });

  it('translates a validation key', () => {
    expect(translate()({ code: 'VALIDATION_FAILED', message: ['phoneInvalid'] })).toBe(
      catalogs.el.Validation.phoneInvalid,
    );
  });

  it('never shows text from the server', () => {
    const generic = catalogs.el.Owner.errors.generic;
    expect(translate()({ code: 'SOMETHING_NEW', message: 'English from a server' })).toBe(generic);
    expect(translate()({ message: 'Internal error at line 12' })).toBe(generic);
    expect(translate()({})).toBe(generic);
  });
});

describe('uploadFile', () => {
  class FakeRequest {
    static last: FakeRequest;
    upload: { onprogress?: (event: Partial<ProgressEvent>) => void } = {};
    status = 0;
    response: unknown = null;
    responseType = '';
    headers = new Map<string, string>();
    onload?: () => void;
    onerror?: () => void;
    body?: unknown;
    url = '';
    constructor() {
      FakeRequest.last = this;
    }
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    send(body: unknown) {
      this.body = body;
    }
    finish(status: number, response: unknown) {
      this.status = status;
      this.response = response;
      this.onload?.();
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const start = (onProgress = vi.fn()) => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    return { file, onProgress, result: uploadFile('/api/upload', file, onProgress) };
  };

  it('sends the file itself, with its type', async () => {
    const { file, result } = start();
    expect(FakeRequest.last.body).toBe(file);
    expect(FakeRequest.last.headers.get('Content-Type')).toBe('image/jpeg');
    FakeRequest.last.finish(201, { id: 'a' });
    await expect(result).resolves.toEqual({ ok: true, data: { id: 'a' } });
  });

  it('reports how far it has got', () => {
    const { onProgress } = start();
    FakeRequest.last.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(onProgress).toHaveBeenCalledWith(25);
  });

  it('passes on a refusal', async () => {
    const { result } = start();
    FakeRequest.last.finish(400, { code: 'PHOTO_TOO_SMALL' });
    await expect(result).resolves.toEqual({ ok: false, failure: { code: 'PHOTO_TOO_SMALL' } });
  });

  it('survives a refusal with no readable body', async () => {
    const { result } = start();
    FakeRequest.last.finish(500, null);
    await expect(result).resolves.toEqual({ ok: false, failure: {} });
  });

  it('answers a dropped connection like any other failure', async () => {
    const { result } = start();
    FakeRequest.last.onerror?.();
    await expect(result).resolves.toEqual({ ok: false, failure: {} });
  });
});
