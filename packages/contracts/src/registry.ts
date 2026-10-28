import { z } from 'zod';

/**
 * Schemas registered here become named components in the API's OpenAPI document
 * (and therefore named types in the generated client).
 */
export const contractsRegistry = z.registry<{ id: string; description?: string }>();
