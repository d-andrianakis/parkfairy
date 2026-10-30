'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  BackupCodeInputSchema,
  TotpInputSchema,
  type BackupCodeInput,
  type TotpInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, authErrorValues, type AuthErrorKey } from '@/lib/auth-errors';
import { useValidationMessage } from '@/lib/use-validation-message';

type Mode = 'totp' | 'backup';

/**
 * The second sign-in step: a code from the authenticator app, or (phone lost) one of the
 * backup codes shown at enrolment, each usable once.
 */
export function TwoFactorForm() {
  const t = useTranslations('TwoFactor');
  const tError = useTranslations('AuthErrors');
  const validationMessage = useValidationMessage();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('totp');
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const totp = useForm<TotpInput>({ resolver: zodResolver(TotpInputSchema) });
  const backup = useForm<BackupCodeInput>({ resolver: zodResolver(BackupCodeInputSchema) });
  const form = mode === 'totp' ? totp : backup;
  const { isSubmitting } = form.formState;

  const status = useInvalidSubmitStatus();
  const done = (error: { code?: string; status?: number } | null) => {
    if (error) {
      setFormError(authErrorKey(error));
      return;
    }
    router.replace('/account');
    router.refresh();
  };
  const onTotp = totp.handleSubmit(async ({ code }) => {
    status.clear();
    setFormError(null);
    done((await authClient.twoFactor.verifyTotp({ code })).error);
  }, status.onInvalid);
  const onBackup = backup.handleSubmit(async ({ code }) => {
    status.clear();
    setFormError(null);
    done((await authClient.twoFactor.verifyBackupCode({ code })).error);
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void (mode === 'totp' ? onTotp : onBackup)(event);
  };
  const switchMode = () => {
    setFormError(null);
    status.clear();
    const next = mode === 'totp' ? 'backup' : 'totp';
    setMode(next);
    // A click commits before the next frame; the new field is there to take focus.
    requestAnimationFrame(() => (next === 'totp' ? totp : backup).setFocus('code'));
  };

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={formError ? tError(formError, authErrorValues(formError)) : null} />
        {mode === 'totp' ? (
          <FormField
            key="totp"
            id="code"
            label={t('code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={validationMessage(totp.formState.errors.code?.message)}
            {...totp.register('code')}
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('backupDescription')}</p>
            <FormField
              key="backup"
              id="backup-code"
              label={t('backupCode')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              error={validationMessage(backup.formState.errors.code?.message)}
              {...backup.register('code')}
            />
          </>
        )}
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
        <Button type="submit" aria-disabled={isSubmitting || undefined}>
          {isSubmitting ? t('submitting') : t('submit')}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto whitespace-normal"
          onClick={switchMode}
        >
          {mode === 'totp' ? t('useBackupCode') : t('useAuthenticator')}
        </Button>
      </FieldGroup>
      {status.region}
    </form>
  );
}
