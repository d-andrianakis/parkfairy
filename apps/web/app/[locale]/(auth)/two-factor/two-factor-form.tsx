'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TotpInputSchema, type TotpInput } from '@parkfairy/contracts';
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

export function TwoFactorForm() {
  const t = useTranslations('TwoFactor');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const router = useRouter();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpInput>({ resolver: zodResolver(TotpInputSchema) });

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    router.replace('/account');
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormError message={formError ? tError(formError) : null} />
      <FormField
        id="code"
        label={t('code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={validationMessage(errors.code?.message)}
        {...register('code')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
