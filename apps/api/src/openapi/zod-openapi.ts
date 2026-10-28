import type { OpenAPIObject } from '@nestjs/swagger';
import { contractsRegistry } from '@parkfairy/contracts';
import { z } from 'zod';

const componentRef = (id: string) => `#/components/schemas/${id}`;

/** `$ref` to a contract schema's named component, for `@ApiOkResponse({ schema })` etc. */
export function schemaRef(schema: z.ZodType): { $ref: string } {
  const meta = contractsRegistry.get(schema);
  if (!meta) {
    throw new Error('Schema is not registered in contractsRegistry; give it an id first.');
  }
  return { $ref: componentRef(meta.id) };
}

/** Adds every registered contract schema to the document's `components.schemas`. */
export function addContractSchemas(document: OpenAPIObject): OpenAPIObject {
  const { schemas } = z.toJSONSchema(contractsRegistry, {
    target: 'openapi-3.0',
    uri: componentRef,
  });
  // `$id` is JSON Schema, not OpenAPI 3.0; the component key already names each schema.
  const components = Object.fromEntries(
    Object.entries(schemas).map(([id, { $id: _ignored, ...schema }]) => [id, schema]),
  );
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...(components as NonNullable<OpenAPIObject['components']>['schemas']),
  };
  return document;
}
