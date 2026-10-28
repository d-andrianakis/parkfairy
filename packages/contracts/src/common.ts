import { z } from 'zod';
import { contractsRegistry } from './registry.js';

export const ErrorResponseSchema = z
  .object({
    statusCode: z.int(),
    message: z.union([z.string(), z.array(z.string())]),
    error: z.string().optional(),
    /** Machine-readable reason, e.g. `MFA_REQUIRED`. */
    code: z.string().optional(),
  })
  .register(contractsRegistry, { id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'error']),
    checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
  })
  .register(contractsRegistry, { id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
