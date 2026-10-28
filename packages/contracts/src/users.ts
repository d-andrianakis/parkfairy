import { z } from 'zod';
import { LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';

export const UserRoleSchema = z.enum(['user', 'admin']).register(contractsRegistry, {
  id: 'UserRole',
  description: 'Platform staff role. Parking ownership is modelled separately.',
});
export type UserRole = z.infer<typeof UserRoleSchema>;

export const MeResponseSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: UserRoleSchema,
    locale: LocaleSchema,
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .register(contractsRegistry, {
    id: 'MeResponse',
    description: 'The authenticated user, as verified by the API.',
  });
export type MeResponse = z.infer<typeof MeResponseSchema>;
