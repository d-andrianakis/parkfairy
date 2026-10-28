import { z } from 'zod';
import { message } from './validation.js';

/** Enforced by Better Auth on the server and by the sign-up form on the client. */
export const PASSWORD_POLICY = { minLength: 10, maxLength: 128 } as const;
export const NAME_MAX_LENGTH = 100;

export const SignUpInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('nameRequired'))
    .max(NAME_MAX_LENGTH, message('nameTooLong')),
  email: z.email(message('emailInvalid')).max(254, message('emailInvalid')),
  password: z
    .string()
    .min(PASSWORD_POLICY.minLength, message('passwordTooShort'))
    .max(PASSWORD_POLICY.maxLength, message('passwordTooLong')),
});
export type SignUpInput = z.infer<typeof SignUpInputSchema>;

export const SignInInputSchema = z.object({
  email: z.email(message('emailInvalid')),
  password: z.string().min(1, message('passwordRequired')),
});
export type SignInInput = z.infer<typeof SignInInputSchema>;

export const TotpInputSchema = z.object({
  code: z.string().regex(/^\d{6}$/, message('codeInvalid')),
});
export type TotpInput = z.infer<typeof TotpInputSchema>;
