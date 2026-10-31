'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInInputSchema, type SignInInput } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { PasswordField, usePasswordReveal } from '@/components/password-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { forgetEverySentTo, rememberEmail } from '@/lib/remembered-email';
import { useValidationMessage } from '@/lib/use-validation-message';

export function SignInForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations('SignIn');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const router = useRouter();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(SignInInputSchema) });

  const status = useInvalidSubmitStatus();
  const reveal = usePasswordReveal();
  const onSubmit = handleSubmit(async (values) => {
    status.clear();
    reveal.hide();
    setFormError(null);
    const { data, error } = await authClient.signIn.email(values);
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    forgetEverySentTo();
    // Accounts with two-factor enabled get no session until the TOTP code is verified.
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      router.push('/two-factor');
      return;
    }
    router.replace(returnTo);
    router.refresh();
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <>
      <form method="post" onSubmit={submit} noValidate>
        <FieldGroup>
          <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
          <FormField
            id="email"
            label={t('email')}
            type="email"
            autoComplete="email"
            error={validationMessage(errors.email?.message)}
            {...register('email')}
          />
          <PasswordField
            id="password"
            label={t('password')}
            autoComplete="current-password"
            reveal={reveal}
            error={validationMessage(errors.password?.message)}
            {...register('password')}
          />
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
          <Button type="submit" aria-disabled={isSubmitting || undefined}>
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </FieldGroup>
        {status.region}
      </form>
      <p className="text-sm">
        <Link
          href="/forgot-password"
          className="text-primary underline underline-offset-4 hover:decoration-2"
          onClick={() => rememberEmail(getValues('email'))}
        >
          {t('forgotPassword')}
        </Link>
      </p>
    </>
  );
}
