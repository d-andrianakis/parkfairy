import type { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UploadGate } from './upload-gate.js';

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as HttpException).getStatus();
  }
  return 'admitted';
};

describe('admit', () => {
  it('holds one user to two uploads at once', () => {
    const gate = new UploadGate();
    const first = gate.admit('a');
    gate.admit('a');
    expect(refusal(() => gate.admit('a'))).toBe(503);
    first();
    expect(refusal(() => gate.admit('a'))).toBe('admitted');
  });

  it('holds everyone together to a total', () => {
    const gate = new UploadGate();
    for (let user = 0; user < 16; user++) gate.admit(`user-${user}`);
    expect(refusal(() => gate.admit('one-more'))).toBe(503);
  });

  it('gives a place back only once', () => {
    const gate = new UploadGate();
    const leave = gate.admit('a');
    gate.admit('a');
    leave();
    leave();
    gate.admit('a');
    expect(refusal(() => gate.admit('a'))).toBe(503);
  });
});

describe('process', () => {
  function deferred() {
    let finish = () => undefined as void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { done, finish };
  }

  it('runs at most two at once and the rest in turn', async () => {
    const gate = new UploadGate();
    const jobs = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const all = jobs.map((job, index) =>
      gate.process(async () => {
        started.push(index);
        await job.done;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    jobs[0]?.finish();
    await all[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    jobs[1]?.finish();
    jobs[2]?.finish();
    jobs[3]?.finish();
    await Promise.all(all);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('frees the slot when the work fails', async () => {
    const gate = new UploadGate();
    await expect(gate.process(() => Promise.reject(new Error('bad image')))).rejects.toThrow();
    await expect(gate.process(() => Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(gate.process(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
