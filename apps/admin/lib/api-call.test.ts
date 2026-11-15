import { describe, expect, it } from 'vitest';
import { attempt } from './api-call';

const response = (status: number) => new Response(null, { status });

describe('calling the API from the browser', () => {
  it('returns the data of an answer that is fine', async () => {
    expect(
      await attempt(() => Promise.resolve({ data: { a: 1 }, response: response(200) })),
    ).toEqual({
      ok: true,
      data: { a: 1 },
    });
  });

  it('returns the refusal and its status', async () => {
    expect(
      await attempt(() =>
        Promise.resolve({ error: { code: 'NOT_IN_REVIEW' }, response: response(409) }),
      ),
    ).toEqual({ ok: false, failure: { code: 'NOT_IN_REVIEW' }, status: 409 });
  });

  it('treats a failing answer with no body as a refusal with no code, keeping the status', async () => {
    expect(await attempt(() => Promise.resolve({ response: response(500) }))).toEqual({
      ok: false,
      failure: {},
      status: 500,
    });
  });

  it('treats a call that threw as the same kind of answer, with no status', async () => {
    expect(await attempt(() => Promise.reject(new Error('network')))).toEqual({
      ok: false,
      failure: {},
    });
  });
});
