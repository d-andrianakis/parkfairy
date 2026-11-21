import { z } from 'zod';

import { LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';
import { message } from './validation.js';

export const UserRoleSchema = z.enum(['user', 'admin']).register(contractsRegistry, {
  id: 'UserRole',
  description: 'Platform staff role. Parking ownership is modelled separately.',
});
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Whether the driver wants a reminder before a stay starts and shortly before it ends (5A.3). */
export const ReminderPreferencesSchema = z
  .object({ reminderEmails: z.boolean() })
  .register(contractsRegistry, { id: 'ReminderPreferences' });
export type ReminderPreferences = z.infer<typeof ReminderPreferencesSchema>;

export const ReminderPreferencesInputSchema = z
  .object({ reminderEmails: z.boolean(message('invalid')) })
  .strict()
  .register(contractsRegistry, { id: 'ReminderPreferencesInput' });
export type ReminderPreferencesInput = z.infer<typeof ReminderPreferencesInputSchema>;

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
