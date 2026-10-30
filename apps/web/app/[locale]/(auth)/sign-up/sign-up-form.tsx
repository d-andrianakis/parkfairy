'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_POLICY, SignUpInputSchema, type SignUpInput } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { useValidationMessage } from '@/lib/use-validation-message';

export function SignUpForm() {
  const t = useTranslations('SignUp');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const locale = useLocale();
  const router = useRouter();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(SignUpInputSchema) });

  const status = useInvalidSubmitStatus();
  const onSubmit = handleSubmit(async (values) => {
    status.clear();
    setFormError(null);
    // The account remembers the language it was created in (emails, notifications).
    const { error } = await authClient.signUp.email({ ...values, locale });
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    router.replace('/account');
    router.refresh();
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
        <FormField
          id="name"
          label={t('name')}
          autoComplete="name"
          error={validationMessage(errors.name?.message)}
          {...register('name')}
        />
        <FormField
          id="email"
          label={t('email')}
          type="email"
          autoComplete="email"
          error={validationMessage(errors.email?.message)}
          {...register('email')}
        />
        <FormField
          id="password"
          label={t('password')}
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_POLICY.minLength}
          hint={t('passwordHint', { min: PASSWORD_POLICY.minLength })}
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
  );
}
