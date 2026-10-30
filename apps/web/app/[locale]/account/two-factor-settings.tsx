'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import { getMeOptions } from '@parkfairy/api-client/react-query';
import {
  PasswordConfirmSchema,
  TotpInputSchema,
  type PasswordConfirm,
  type TotpInput,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { QrCode } from '@/components/qr-code';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { authErrorKey, type AuthErrorKey } from '@/lib/auth-errors';
import { useValidationMessage } from '@/lib/use-validation-message';

type Step = 'idle' | 'confirm-enable' | 'scan' | 'backup' | 'confirm-disable';
type AuthResult = Promise<{ error: { code?: string; status?: number } | null }>;

/** The base32 secret inside an otpauth:// URI, grouped for typing by hand. */
function manualKey(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** Heading of the current step; receives focus when the step changes. */
function StepHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h3 ref={ref} tabIndex={-1} className="text-base font-semibold outline-none">
      {children}
    </h3>
  );
}

/** Asks for the password again before a security change; `onConfirm` calls Better Auth. */
function PasswordStep({
  heading,
  submitLabel,
  onConfirm,
  onCancel,
}: {
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

  const onSubmit = handleSubmit(async ({ password }) => {
    status.clear();
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
      <FieldGroup className="gap-4">
        <FormError message={formError ? tError(formError) : null} />
        <FormField
          id="two-factor-password"
          label={t('password')}
          type="password"
          autoComplete="current-password"
          error={validationMessage(errors.password?.message)}
          {...register('password')}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" aria-disabled={isSubmitting || undefined}>
            {isSubmitting ? t('working') : submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}

/** QR code (and the same key as text), then the first code turns two-factor on. */
function ScanStep({
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
        <dd
          className="w-fit rounded-md bg-muted px-3 py-2 font-mono tracking-wider break-all"
          data-testid="two-factor-key"
        >
          {manualKey(totpURI)}
        </dd>
      </dl>
      <FieldGroup className="gap-4">
        <FormError message={formError ? tError(formError) : null} />
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
          <Button type="submit" aria-disabled={isSubmitting || undefined}>
            {isSubmitting ? t('verifying') : t('verify')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}

/**
 * Turning two-factor authentication on and off from the account page (Better Auth's
 * twoFactor plugin). Admin routes require it, so this is how staff unlock them.
 */
export function TwoFactorSettings({ enabled: initiallyEnabled }: { enabled: boolean }) {
  const t = useTranslations('TwoFactorSettings');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<Step>('idle');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const idleButton = useRef<HTMLButtonElement>(null);

  // Back on the overview: keep the keyboard on the button that started (or ends) the change.
  const backToIdle = () => {
    setStep('idle');
    requestAnimationFrame(() => idleButton.current?.focus());
  };
  const changed = (nowEnabled: boolean) => {
    setEnabled(nowEnabled);
    void queryClient.invalidateQueries({ queryKey: getMeOptions().queryKey });
    router.refresh();
  };

  if (step === 'confirm-enable') {
    return (
      <PasswordStep
        heading={t('confirmHeading')}
        submitLabel={t('continue')}
        onCancel={backToIdle}
        onConfirm={async (password) => {
          const { data, error } = await authClient.twoFactor.enable({ password, method: 'totp' });
          if (data?.method === 'totp') {
            setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
            setStep('scan');
          }
          return { error };
        }}
      />
    );
  }

  if (step === 'scan' && setup) {
    return (
      <ScanStep
        totpURI={setup.totpURI}
        onCancel={backToIdle}
        onVerified={() => {
          changed(true);
          setStep('backup');
        }}
      />
    );
  }

  if (step === 'backup' && setup) {
    return (
      <div className="grid gap-4">
        <StepHeading>{t('backupHeading')}</StepHeading>
        <p className="text-sm text-muted-foreground">{t('backupText')}</p>
        <ul
          aria-label={t('backupListLabel')}
          className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono"
        >
          {setup.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button
          className="h-auto min-h-9 w-fit max-w-full whitespace-normal"
          onClick={() => {
            setSetup(null); // the codes are not kept once dismissed
            backToIdle();
          }}
        >
          {t('done')}
        </Button>
      </div>
    );
  }

  if (step === 'confirm-disable') {
    return (
      <PasswordStep
        heading={t('confirmHeading')}
        submitLabel={t('turnOff')}
        onCancel={backToIdle}
        onConfirm={async (password) => {
          const { error } = await authClient.twoFactor.disable({ password });
          if (!error) {
            changed(false);
            backToIdle();
          }
          return { error };
        }}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p
        id="two-factor-status"
        className="flex items-start gap-2 text-sm"
        data-testid="two-factor-status"
      >
        {enabled ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-available" aria-hidden />
        ) : (
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        {enabled ? t('statusOn') : t('statusOff')}
      </p>
      {/* Focus returns here after a change, so the button also reads out the new state. */}
      <Button
        ref={idleButton}
        aria-describedby="two-factor-status"
        className="h-auto min-h-9 w-fit max-w-full whitespace-normal"
        variant={enabled ? 'outline' : 'default'}
        onClick={() => setStep(enabled ? 'confirm-disable' : 'confirm-enable')}
      >
        {enabled ? t('turnOff') : t('setUp')}
      </Button>
    </div>
  );
}
