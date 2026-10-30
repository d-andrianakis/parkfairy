'use client';

import { getMeOptions } from '@parkfairy/api-client/react-query';
import { Button } from '@parkfairy/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';

// The steps bring zod, react-hook-form and the QR encoder; the overview loads them on intent
// (hover, focus) and at the latest when a change starts.
const loadSteps = () => import('./two-factor-steps');
const PasswordStep = lazy(() => loadSteps().then((m) => ({ default: m.PasswordStep })));
const ScanStep = lazy(() => loadSteps().then((m) => ({ default: m.ScanStep })));
const BackupCodesStep = lazy(() => loadSteps().then((m) => ({ default: m.BackupCodesStep })));

type Step = 'idle' | 'confirm-enable' | 'scan' | 'backup' | 'confirm-disable';

/**
 * Turning two-factor authentication on and off from the account page (Better Auth's
 * twoFactor plugin). Admin routes require it, so this is how staff unlock them.
 */
export function TwoFactorSettings({
  enabled: initiallyEnabled,
  email,
}: {
  enabled: boolean;
  email: string;
}) {
  const t = useTranslations('TwoFactorSettings');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<Step>('idle');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const idleButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Back on the overview, focus the button that started (or ends) the change once React has
  // rendered it: after an awaited request that commit can come later than the next frame.
  useEffect(() => {
    if (step !== 'idle' || !returnFocus.current) return;
    returnFocus.current = false;
    idleButton.current?.focus();
  }, [step]);
  const backToIdle = () => {
    returnFocus.current = true;
    setStep('idle');
  };
  const changed = (nowEnabled: boolean) => {
    setEnabled(nowEnabled);
    void queryClient.invalidateQueries({ queryKey: getMeOptions().queryKey });
    router.refresh();
  };

  let current = null;
  if (step === 'confirm-enable') {
    current = (
      <PasswordStep
        email={email}
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
  } else if (step === 'scan' && setup) {
    current = (
      <ScanStep
        totpURI={setup.totpURI}
        onCancel={backToIdle}
        onVerified={() => {
          changed(true);
          setStep('backup');
        }}
      />
    );
  } else if (step === 'backup' && setup) {
    current = (
      <BackupCodesStep
        codes={setup.backupCodes}
        onDone={() => {
          setSetup(null); // the codes are not kept once dismissed
          backToIdle();
        }}
      />
    );
  } else if (step === 'confirm-disable') {
    current = (
      <PasswordStep
        email={email}
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
  if (current) return <Suspense fallback={null}>{current}</Suspense>;

  const preload = () => void loadSteps();
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
        onPointerEnter={preload}
        onFocus={preload}
        onClick={() => setStep(enabled ? 'confirm-disable' : 'confirm-enable')}
      >
        {enabled ? t('turnOff') : t('setUp')}
      </Button>
    </div>
  );
}
