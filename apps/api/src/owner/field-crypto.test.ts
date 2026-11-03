import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCrypto, fieldKey } from './field-crypto.js';

const crypto = createFieldCrypto(randomBytes(32));

describe('field crypto', () => {
  it('round-trips a value', () => {
    const stored = crypto.encrypt('123456789', 'owner:taxId');
    expect(crypto.decrypt(stored, 'owner:taxId')).toBe('123456789');
  });

  it('never stores the value in the clear, and differs each time', () => {
    const first = crypto.encrypt('123456789', 'owner:taxId');
    const second = crypto.encrypt('123456789', 'owner:taxId');
    expect(first).not.toContain('123456789');
    expect(Buffer.from(first.split('.')[3] ?? '', 'base64url').toString()).not.toContain('1234');
    expect(first).not.toBe(second);
  });

  it('refuses a value copied to another owner or field', () => {
    const stored = crypto.encrypt('123456789', 'owner-a:taxId');
    expect(() => crypto.decrypt(stored, 'owner-b:taxId')).toThrow();
    expect(() => crypto.decrypt(stored, 'owner-a:vatId')).toThrow();
  });

  it('refuses a value that was tampered with', () => {
    const parts = crypto.encrypt('123456789', 'owner:taxId').split('.');
    const data = Buffer.from(parts[3] ?? '', 'base64url');
    data[0] = (data[0] ?? 0) ^ 1;
    parts[3] = data.toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'), 'owner:taxId')).toThrow();
  });

  it('refuses a shortened tag', () => {
    const parts = crypto.encrypt('123456789', 'owner:taxId').split('.');
    parts[2] = Buffer.from(parts[2] ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'), 'owner:taxId')).toThrow();
  });

  it('refuses a value from another key', () => {
    const stored = createFieldCrypto(randomBytes(32)).encrypt('123456789', 'owner:taxId');
    expect(() => crypto.decrypt(stored, 'owner:taxId')).toThrow();
  });

  it('refuses unknown formats', () => {
    expect(() => crypto.decrypt('v2.a.b.c', 'owner:taxId')).toThrow('Unreadable');
    expect(() => crypto.decrypt('123456789', 'owner:taxId')).toThrow('Unreadable');
  });

  it('refuses a key of the wrong size', () => {
    expect(() => createFieldCrypto(randomBytes(16))).toThrow('32 bytes');
  });
});

describe('fieldKey', () => {
  it('uses the configured key', () => {
    const key = randomBytes(32);
    expect(fieldKey(key.toString('base64'), 'secret').equals(key)).toBe(true);
  });

  it('derives one for this machine from the session secret', () => {
    expect(fieldKey(undefined, 'secret')).toHaveLength(32);
    expect(fieldKey(undefined, 'secret').equals(fieldKey(undefined, 'other'))).toBe(false);
  });
});
