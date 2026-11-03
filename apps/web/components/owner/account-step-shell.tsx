import type { AccountStep } from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';

/** A page for one of the account's steps, or the "try again" state if the API didn't answer. */
export function AccountStepShell({
  step,
  available,
  children,
}: {
  step: AccountStep;
  available: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('Owner');
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-10">
      <Link
        href="/owner"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4 hover:decoration-2"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('step.back')}
      </Link>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`stepNames.${step}`)}</h1>
        <p className="text-muted-foreground">{t(`stepLeads.${step}`)}</p>
      </div>
      {available ? (
        <ClientMessages namespaces={CLIENT_NAMESPACES.owner}>{children}</ClientMessages>
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
