'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SignInInputSchema, type SignInInput } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, type AuthErrorKey } from '@/lib/auth-errors';
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
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(SignInInputSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { data, error } = await authClient.signIn.email(values);
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    // Accounts with two-factor enabled get no session until the TOTP code is verified.
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      router.push('/two-factor');
      return;
    }
    router.replace(returnTo);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormError message={formError ? tError(formError) : null} />
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
        autoComplete="current-password"
        error={validationMessage(errors.password?.message)}
        {...register('password')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
