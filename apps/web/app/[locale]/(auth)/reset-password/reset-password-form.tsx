'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PASSWORD_POLICY,
  ResetPasswordInputSchema,
  type ResetPasswordInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { PasswordField, usePasswordReveal } from '@/components/password-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('ResetPassword');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const router = useRouter();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(ResetPasswordInputSchema) });

  const status = useInvalidSubmitStatus();
  const reveal = usePasswordReveal();
  const onSubmit = handleSubmit(async ({ password }) => {
    status.clear();
    reveal.hide();
    setFormError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    // Off the page with the spent token, which leaves the address bar and the history too.
    router.replace('/reset-password?done=1');
    router.refresh(); // every session just ended, this browser's included
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <form method="post" onSubmit={submit} noValidate>
        <FieldGroup>
          <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
          <PasswordField
            id="password"
            label={t('password')}
            autoComplete="new-password"
            reveal={reveal}
            minLength={PASSWORD_POLICY.minLength}
            hint={t('passwordHint', { min: PASSWORD_POLICY.minLength })}
            error={validationMessage(errors.password?.message)}
            {...register('password')}
          />
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
          <Button
            type="submit"
            className={WRAPPING_BUTTON}
            aria-disabled={isSubmitting || undefined}
          >
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
          {formError === 'INVALID_TOKEN' ? (
            <Button asChild variant="outline" className={WRAPPING_BUTTON}>
              <Link href="/forgot-password">{t('requestNew')}</Link>
            </Button>
          ) : null}
        </FieldGroup>
        {status.region}
      </form>
    </div>
  );
}
