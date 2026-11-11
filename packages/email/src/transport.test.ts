import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { outboxTransport, resendTransport } from './transport.js';

const email = {
  to: 'maria@example.gr',
  subject: 'Επιβεβαίωση',
  text: 'link: https://parkfairy.example/verify?token=secret',
  html: '<p>hello</p>',
};

function resend(responses: (number | Error | Response)[], intervalMs?: number) {
  const fetchFn = vi.fn<typeof fetch>(() => {
    const next = responses.shift() ?? 200;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next instanceof Response ? next : new Response(null, { status: next }));
  });
  const wait = vi.fn(() => Promise.resolve());
  return {
    fetchFn,
    wait,
    transport: resendTransport({ apiKey: 're_k', from: 'P <a@b.gr>', fetchFn, wait, intervalMs }),
  };
}

const requestAt = (fetchFn: ReturnType<typeof resend>['fetchFn'], index: number) => {
  const [url, init] = fetchFn.mock.calls[index] ?? [];
  return {
    url,
    headers: new Headers(init?.headers),
    body: JSON.parse((init?.body ?? '') as string) as object,
  };
};

describe('resendTransport', () => {
  it('posts one message to Resend, with a key to make retries safe', async () => {
    const { fetchFn, transport } = resend([200]);
    await transport.send(email);

    const { url, headers, body } = requestAt(fetchFn, 0);
    expect(url).toBe('https://api.resend.com/emails');
    expect(headers.get('authorization')).toBe('Bearer re_k');
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      from: 'P <a@b.gr>',
      to: ['maria@example.gr'],
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([429, 409, 500, 503])('retries a %i with the same key', async (status) => {
    const { fetchFn, wait, transport } = resend([status, 200]);
    await transport.send(email);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(500, undefined);
    expect(requestAt(fetchFn, 1).headers.get('idempotency-key')).toBe(
      requestAt(fetchFn, 0).headers.get('idempotency-key'),
    );
  });

  it('retries a network failure and gives up after three tries', async () => {
    const { fetchFn, transport } = resend([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ]);
    await expect(transport.send(email)).rejects.toThrow('TypeError');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 422])(
    'does not repeat a %i: only fixing the request helps',
    async (status) => {
      const { fetchFn, transport } = resend([status]);
      await expect(transport.send(email)).rejects.toThrow(`Resend answered ${status}`);
      expect(fetchFn).toHaveBeenCalledOnce();
    },
  );

  it('spaces a burst out to stay under Resend’s limit', async () => {
    const { fetchFn, wait, transport } = resend([200, 200, 200]);

    await Promise.all([transport.send(email), transport.send(email), transport.send(email)]);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    const delays = wait.mock.calls.map(([ms]: number[]) => ms ?? 0);
    expect(delays).toHaveLength(2);
    // One a second: the web app and the worker share Resend's 2 a second.
    expect(delays[0]).toBeGreaterThan(900);
    expect(delays[1]).toBeGreaterThan(1_900);
  });

  it('goes at the pace it is given, when Resend’s limit allows more', async () => {
    const { wait, transport } = resend([200, 200], 250);

    await Promise.all([transport.send(email), transport.send(email)]);

    const [delay] = wait.mock.calls.map(([ms]: number[]) => ms ?? 0);
    expect(delay).toBeGreaterThan(150);
    expect(delay).toBeLessThanOrEqual(250);
  });

  it('waits as long as Retry-After asks, within reason', async () => {
    const limited = (seconds: string) =>
      new Response(null, { status: 429, headers: { 'retry-after': seconds } });
    const { wait, transport } = resend([limited('7'), limited('86400'), 200]);

    await transport.send(email);

    expect(wait).toHaveBeenCalledWith(7_000, undefined);
    expect(wait).toHaveBeenCalledWith(30_000, undefined); // a quota hours away must not hold the process
  });

  it('names Resend’s error, so an unverified domain shows in the logs', async () => {
    const answer = Response.json(
      { name: 'validation_error', message: 'The maria@example.gr domain is not verified' },
      { status: 403 },
    );
    const { transport } = resend([answer]);

    const error = await transport.send(email).catch((caught: unknown) => caught);

    expect(String(error)).toContain('Resend answered 403 validation_error');
    expect(String(error)).not.toContain('maria'); // Resend's message can echo the address
  });

  it('ignores an error body that is not what Resend documents', async () => {
    const { transport } = resend([new Response('<html>Bad gateway</html>', { status: 400 })]);
    await expect(transport.send(email)).rejects.toThrow(/^Resend answered 400$/);
  });

  it('closes a successful answer it has no use for', async () => {
    const answer = Response.json({ id: '49a3999c' });
    const { transport } = resend([answer]);
    await transport.send(email);
    expect(answer.bodyUsed || answer.body?.locked).toBeTruthy();
  });

  it('gives up on a Resend that never answers', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
        }),
    );
    const transport = resendTransport({
      apiKey: 're_k',
      from: 'P <a@b.gr>',
      fetchFn,
      wait: () => Promise.resolve(),
      timeoutMs: 1,
    });

    await expect(transport.send(email)).rejects.toThrow('Error');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('reports failures without the address or the link', async () => {
    const { transport } = resend([500, 500, 500]);
    const error = await transport.send(email).catch((caught: unknown) => caught);
    expect(String(error)).not.toMatch(/maria|token/);
  });

  describe('stopped by its caller', () => {
    const stop = new Error('time is up');

    it('drops the request in flight and tries no more', async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn<typeof fetch>(
        (_, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            controller.abort(stop);
          }),
      );
      const transport = resendTransport({ apiKey: 're_k', from: 'P <a@b.gr>', fetchFn });

      await expect(transport.send(email, { signal: controller.signal })).rejects.toBe(stop);
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('stops waiting between tries', async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn<typeof fetch>(() => {
        // Resend fails, and the caller gives up during the 500 ms before the next try.
        setTimeout(() => controller.abort(stop), 10);
        return Promise.resolve(new Response(null, { status: 503 }));
      });
      const transport = resendTransport({ apiKey: 're_k', from: 'P <a@b.gr>', fetchFn });
      const started = performance.now();

      await expect(transport.send(email, { signal: controller.signal })).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(performance.now() - started).toBeLessThan(400);
    });

    it('sends nothing once stopped', async () => {
      const { fetchFn, transport } = resend([200]);
      await expect(transport.send(email, { signal: AbortSignal.abort(stop) })).rejects.toBe(stop);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('still times out a request that never answers', async () => {
      const fetchFn = vi.fn<typeof fetch>(
        (_, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
          }),
      );
      const transport = resendTransport({
        apiKey: 're_k',
        from: 'P <a@b.gr>',
        fetchFn,
        wait: () => Promise.resolve(),
        timeoutMs: 1,
      });

      const signal = new AbortController().signal;
      await expect(transport.send(email, { signal })).rejects.toThrow('Error');
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });
  });
});

let directory = '';

describe('outboxTransport', () => {
  it('rejects when the folder cannot be written', async () => {
    directory = mkdtempSync(join(tmpdir(), 'parkfairy-outbox-'));
    const file = join(directory, 'a-file');
    writeFileSync(file, '');
    await expect(outboxTransport(join(file, 'nested')).send(email)).rejects.toThrow();
  });

  it('writes nothing once stopped', async () => {
    directory = mkdtempSync(join(tmpdir(), 'parkfairy-outbox-'));
    const stop = new Error('shutting down');
    await expect(
      outboxTransport(directory).send(email, { signal: AbortSignal.abort(stop) }),
    ).rejects.toBe(stop);
    expect(readdirSync(directory)).toEqual([]);
  });

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('writes each email as a complete file, creating the folder', async () => {
    directory = mkdtempSync(join(tmpdir(), 'parkfairy-outbox-'));
    const outbox = join(directory, 'nested');

    await outboxTransport(outbox).send(email);
    await outboxTransport(outbox).send(email);

    expect(existsSync(outbox)).toBe(true);
    const files = readdirSync(outbox);
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith('.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(outbox, files[0] ?? ''), 'utf8'))).toEqual(email);
  });
});
