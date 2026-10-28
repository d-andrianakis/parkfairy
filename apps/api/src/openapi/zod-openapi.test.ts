import { MeResponseSchema } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { addContractSchemas, schemaRef } from './zod-openapi.js';

describe('schemaRef', () => {
  it('points at the named component of a registered contract', () => {
    expect(schemaRef(MeResponseSchema)).toEqual({ $ref: '#/components/schemas/MeResponse' });
  });

  it('refuses schemas that are not registered (they would be anonymous in the client)', () => {
    expect(() => schemaRef(z.object({ x: z.string() }))).toThrow(/not registered/);
  });
});

describe('addContractSchemas', () => {
  const document = addContractSchemas({
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {},
  });
  const schemas = document.components?.schemas ?? {};

  it('adds every contract as a component without JSON-Schema-only keywords', () => {
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining(['MeResponse', 'Locale']));
    for (const schema of Object.values(schemas)) expect(schema).not.toHaveProperty('$id');
  });

  it('references nested contracts instead of inlining them', () => {
    expect(JSON.stringify(schemas.MeResponse)).toContain('#/components/schemas/Locale');
  });
});
