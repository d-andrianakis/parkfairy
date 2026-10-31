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
    .max(NAME_MAX_LENGTH, message('nameTooLong'))
    // Nothing a person types. Only a new account reaches Postgres, which refuses NUL and rewrites
    // a lone surrogate, so either would tell a free address from a taken one.
    .refine((name) => !/[\p{Cc}\p{Cs}]/u.test(name), message('invalid')),
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

/** How long the links in account emails work; Better Auth, the emails and the pages agree. */
export const ACCOUNT_LINK_LIFETIME = { verifyEmailHours: 24, resetPasswordMinutes: 60 } as const;

/** Asks for an account email by address (password reset, a new confirmation link). */
export const EmailLinkInputSchema = z.object({ email: SignUpInputSchema.shape.email });
export type EmailLinkInput = z.infer<typeof EmailLinkInputSchema>;

/** The new password on the page a reset link opens. */
export const ResetPasswordInputSchema = z.object({ password: SignUpInputSchema.shape.password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;

/** Re-entering the password to change security settings (e.g. two-factor). */
export const PasswordConfirmSchema = z.object({
  password: z.string().min(1, message('passwordRequired')),
});
export type PasswordConfirm = z.infer<typeof PasswordConfirmSchema>;

/** Wrong two-factor codes at sign-in before the account locks, and for how long. */
export const TWO_FACTOR_LOCKOUT = { maxFailedAttempts: 10, minutes: 15 } as const;

/** One of the backup codes shown at enrolment (Better Auth's look like `AbCdE-12345`). */
export const BackupCodeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, message('backupCodeRequired'))
    .max(64, message('backupCodeRequired')),
});
export type BackupCodeInput = z.infer<typeof BackupCodeInputSchema>;

export const TotpInputSchema = z.object({
  code: z.string().regex(/^\d{6}$/, message('codeInvalid')),
});
export type TotpInput = z.infer<typeof TotpInputSchema>;
