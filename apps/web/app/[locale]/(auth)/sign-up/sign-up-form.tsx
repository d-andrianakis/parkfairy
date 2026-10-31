'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ACCOUNT_LINK_LIFETIME,
  PASSWORD_POLICY,
  SignUpInputSchema,
  type SignUpInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { PasswordField, usePasswordReveal } from '@/components/password-field';
import { SentPlaceholder } from '@/components/sent-placeholder';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { useSentPanel } from '@/lib/sent-panel';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/**
 * What follows a sign-up. It reads the same when the address already has an account (Better
 * Auth answers alike, and that account's owner gets an email saying so), so it gives nothing
 * away about who is registered.
 */
function CheckYourEmail({ email }: { email: string }) {
  const t = useTranslations('SignUp');
  const tError = useTranslations('AuthErrors');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [resendError, setResendError] = useState<AuthErrorKey | null>(null);

  async function resend() {
    if (sending) return;
    setSending(true);
    setSent(false);
    setResendError(null);
    const { error } = await authClient.sendVerificationEmail({ email });
    setSending(false);
    if (error) setResendError(authErrorKey(error));
    else setSent(true);
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <FocusHeading retitle>{t('sentTitle')}</FocusHeading>
        <p className="text-sm wrap-anywhere text-muted-foreground">
          {t('sentBody', { email, hours: ACCOUNT_LINK_LIFETIME.verifyEmailHours })}
        </p>
        <p className="text-sm text-muted-foreground">{t('sentHint')}</p>
      </div>
      <FormError message={resendError ? tError(resendError, authErrorValues(resendError)) : null} />
      <Button
        type="button"
        variant="outline"
        className={WRAPPING_BUTTON}
        aria-disabled={sending || undefined}
        onClick={() => void resend()}
      >
        {sending ? t('resending') : t('resend')}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {sent ? t('resent') : null}
      </p>
    </div>
  );
}

export function SignUpForm() {
  const t = useTranslations('SignUp');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const locale = useLocale();
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const sent = useSentPanel();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(SignUpInputSchema) });

  const status = useInvalidSubmitStatus();
  const reveal = usePasswordReveal();
  const onSubmit = handleSubmit(async (values) => {
    status.clear();
    reveal.hide();
    setFormError(null);
    // The account remembers the language it was created in (emails, notifications).
    const { error } = await authClient.signUp.email({ ...values, locale });
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    sent.show(values.email);
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  if (sent.waiting) {
    return <SentPlaceholder className="min-h-56">{t('sentTitle')}</SentPlaceholder>;
  }
  if (sent.sentTo) return <CheckYourEmail email={sent.sentTo} />;

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
        <Button type="submit" className={WRAPPING_BUTTON} aria-disabled={isSubmitting || undefined}>
          {isSubmitting ? t('submitting') : t('submit')}
        </Button>
      </FieldGroup>
      {status.region}
    </form>
  );
}
