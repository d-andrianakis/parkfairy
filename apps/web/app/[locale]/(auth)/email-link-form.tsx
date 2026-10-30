'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ACCOUNT_LINK_LIFETIME,
  EmailLinkInputSchema,
  type EmailLinkInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { takeRememberedEmail } from '@/lib/remembered-email';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

const LIFETIME = {
  hours: ACCOUNT_LINK_LIFETIME.verifyEmailHours,
  minutes: ACCOUNT_LINK_LIFETIME.resetPasswordMinutes,
};

/**
 * Asks for a password-reset link or a new confirmation link. The answer never says whether
 * the address has an account: an unknown one gets the same message and no email. `intro` says
 * what to do, so it goes when the form does.
 */
export function EmailLinkForm({
  purpose,
  intro,
}: {
  purpose: 'reset-password' | 'verify-email';
  intro: string;
}) {
  const t = useTranslations(purpose === 'reset-password' ? 'ForgotPassword' : 'VerifyEmail');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmailLinkInput>({ resolver: zodResolver(EmailLinkInputSchema) });

  // Whatever was typed on sign-in; nobody should have to enter it twice.
  useEffect(() => {
    const email = purpose === 'reset-password' ? takeRememberedEmail() : null;
    if (email) setValue('email', email);
  }, [purpose, setValue]);

  const status = useInvalidSubmitStatus();
  const onSubmit = handleSubmit(async ({ email }) => {
    status.clear();
    setFormError(null);
    const { error } = await (purpose === 'reset-password'
      ? authClient.requestPasswordReset({ email })
      : authClient.sendVerificationEmail({ email }));
    if (error) setFormError(authErrorKey(error));
    else setSentTo(email);
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  if (sentTo) {
    return (
      <div className="grid gap-2">
        <FocusHeading retitle>{t('sentTitle')}</FocusHeading>
        <p className="text-sm wrap-anywhere text-muted-foreground">
          {t('sentBody', { email: sentTo, ...LIFETIME })}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{intro}</p>
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
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
          <Button
            type="submit"
            className={WRAPPING_BUTTON}
            aria-disabled={isSubmitting || undefined}
          >
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </FieldGroup>
        {status.region}
      </form>
    </div>
  );
}
