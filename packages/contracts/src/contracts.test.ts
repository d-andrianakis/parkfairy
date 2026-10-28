import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  contractsRegistry,
  DEFAULT_LOCALE,
  isLocale,
  isValidationMessage,
  LocaleSchema,
  MeResponseSchema,
  PASSWORD_POLICY,
  SignInInputSchema,
  SignUpInputSchema,
  SUPPORTED_LOCALES,
  TotpInputSchema,
} from './index.js';

function issueMessages(result: { success: boolean; error?: z.ZodError }): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

describe('sign-up input', () => {
  it('accepts valid input and trims the name', () => {
    const parsed = SignUpInputSchema.parse({
      name: '  Maria  ',
      email: 'maria@example.gr',
      password: 'x'.repeat(PASSWORD_POLICY.minLength),
    });
    expect(parsed.name).toBe('Maria');
  });

  it('reports translation keys rather than English text', () => {
    const result = SignUpInputSchema.safeParse({ name: '   ', email: 'nope', password: 'short' });
    expect(issueMessages(result).sort()).toEqual([
      'emailInvalid',
      'nameRequired',
      'passwordTooShort',
    ]);
  });

  it('enforces the upper password bound', () => {
    const result = SignUpInputSchema.safeParse({
      name: 'Maria',
      email: 'maria@example.gr',
      password: 'x'.repeat(PASSWORD_POLICY.maxLength + 1),
    });
    expect(issueMessages(result)).toEqual(['passwordTooLong']);
  });
});

describe('every validation message is a catalog key', () => {
  const invalidInputs: [z.ZodType, unknown][] = [
    [SignUpInputSchema, { name: '', email: '', password: '' }],
    [SignUpInputSchema, { name: 'x'.repeat(500), email: 'a@b.co', password: 'x'.repeat(500) }],
    [SignInInputSchema, { email: 'nope', password: '' }],
    [TotpInputSchema, { code: '12ab' }],
  ];

  it.each(invalidInputs)('%#', (schema, input) => {
    const messages = issueMessages(schema.safeParse(input));
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(isValidationMessage(message), message).toBe(true);
  });
});

describe('locales', () => {
  it('ships Greek as the default and English', () => {
    expect(SUPPORTED_LOCALES).toEqual(['el', 'en']);
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('rejects locales the product does not ship', () => {
    expect(LocaleSchema.safeParse('de').success).toBe(false);
    expect(isLocale('de')).toBe(false);
    expect(isLocale('el')).toBe(true);
  });
});

describe('MeResponse', () => {
  const me = {
    id: '6eae16ad-2ef5-451c-a2b8-301747d83f7e',
    email: 'maria@example.gr',
    name: 'Maria',
    role: 'user',
    locale: 'el',
    emailVerified: false,
    twoFactorEnabled: false,
    createdAt: '2026-10-28T15:43:07.307Z',
  };

  it('strips fields that are not part of the public contract', () => {
    const parsed = MeResponseSchema.parse({ ...me, password: 'hash', banned: false });
    expect(parsed).toEqual(me);
  });

  it('requires an ISO timestamp in UTC', () => {
    expect(MeResponseSchema.safeParse({ ...me, createdAt: '28/10/2026' }).success).toBe(false);
  });
});

describe('OpenAPI registry', () => {
  it('gives every registered schema a unique component id', () => {
    const { schemas } = z.toJSONSchema(contractsRegistry, { target: 'openapi-3.0' });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'Locale',
        'UserRole',
        'MeResponse',
        'ErrorResponse',
        'HealthResponse',
      ]),
    );
  });
});
