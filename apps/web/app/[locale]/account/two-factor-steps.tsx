'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PasswordConfirmSchema,
  TotpInputSchema,
  type PasswordConfirm,
  type TotpInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { PasswordField, usePasswordReveal } from '@/components/password-field';
import { QrCode } from '@/components/qr-code';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

// The steps of two-factor-settings.tsx, loaded only once someone starts a change: they bring
// zod, react-hook-form and the QR encoder, which the overview does not need.

export type AuthResult = Promise<{ error: { code?: string; status?: number } | null }>;

/** The base32 secret inside an otpauth:// URI, grouped for typing by hand. */
function manualKey(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** Heading of the current step; receives focus when the step appears. */
function StepHeading({ children }: { children: ReactNode }) {
  return <FocusHeading level="h3">{children}</FocusHeading>;
}

/** Asks for the password again before a security change; `onConfirm` calls Better Auth. */
export function PasswordStep({
  email,
  heading,
  submitLabel,
  onConfirm,
  onCancel,
}: {
  email: string;
  heading: string;
  submitLabel: string;
  onConfirm: (password: string) => AuthResult;
  onCancel: () => void;
}) {
  const t = useTranslations('TwoFactorSettings');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const status = useInvalidSubmitStatus();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordConfirm>({ resolver: zodResolver(PasswordConfirmSchema) });

  const reveal = usePasswordReveal();
  const onSubmit = handleSubmit(async ({ password }) => {
    status.clear();
    reveal.hide();
    setFormError(null);
    const { error } = await onConfirm(password);
    if (error) setFormError(authErrorKey(error));
  }, status.onInvalid);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <form method="post" onSubmit={submit} noValidate className="grid gap-4">
      <StepHeading>{heading}</StepHeading>
      <p className="text-sm text-muted-foreground">{t('confirmText')}</p>
      {/* Lets password managers pick the right login (3.3.8 relies on them). */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <FieldGroup className="gap-4">
        <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
        <PasswordField
          id="two-factor-password"
          label={t('password')}
          autoComplete="current-password"
          reveal={reveal}
          error={validationMessage(errors.password?.message)}
          {...register('password')}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className={WRAPPING_BUTTON}
            aria-disabled={isSubmitting || undefined}
          >
            {isSubmitting ? t('working') : submitLabel}
          </Button>
          <Button type="button" variant="outline" className={WRAPPING_BUTTON} onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}

/** QR code (and the same key as text), then the first code turns two-factor on. */
export function ScanStep({
  totpURI,
  onVerified,
  onCancel,
}: {
  totpURI: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('TwoFactorSettings');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const status = useInvalidSubmitStatus();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpInput>({ resolver: zodResolver(TotpInputSchema) });

  const onSubmit = handleSubmit(async ({ code }) => {
    status.clear();
    setFormError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) setFormError(authErrorKey(error));
    else onVerified();
  }, status.onInvalid);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <form method="post" onSubmit={submit} noValidate className="grid gap-4">
      <StepHeading>{t('scanHeading')}</StepHeading>
      <p className="text-sm text-muted-foreground">{t('scanText')}</p>
      <QrCode value={totpURI} label={t('qrLabel')} className="size-48 rounded-md border" />
      <dl className="grid gap-1 text-sm">
        <dt>{t('manualKey')}</dt>
        {/* Groups of four wrap at their spaces, never inside a group. */}
        <dd
          className="w-fit rounded-md bg-muted px-3 py-2 font-mono tracking-wider"
          data-testid="two-factor-key"
        >
          {manualKey(totpURI)}
        </dd>
      </dl>
      <FieldGroup className="gap-4">
        <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
        <FormField
          id="two-factor-code"
          label={t('code')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={validationMessage(errors.code?.message)}
          {...register('code')}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className={WRAPPING_BUTTON}
            aria-disabled={isSubmitting || undefined}
          >
            {isSubmitting ? t('verifying') : t('verify')}
          </Button>
          <Button type="button" variant="outline" className={WRAPPING_BUTTON} onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}

/** The backup codes, shown once; dismissing them forgets them. */
export function BackupCodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('TwoFactorSettings');
  return (
    <div className="grid gap-4">
      <StepHeading>{t('backupHeading')}</StepHeading>
      <p className="text-sm text-muted-foreground">{t('backupText')}</p>
      {/* One column on the narrowest phones: a code must never break across lines. */}
      <ul
        aria-label={t('backupListLabel')}
        className="grid w-fit grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono min-[22rem]:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="whitespace-nowrap">
            {code}
          </li>
        ))}
      </ul>
      <Button className={`w-fit ${WRAPPING_BUTTON}`} onClick={onDone}>
        {t('done')}
      </Button>
    </div>
  );
}
