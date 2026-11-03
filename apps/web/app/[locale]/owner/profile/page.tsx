import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountStepShell } from '@/components/owner/account-step-shell';
import { ProfileForm } from '@/components/owner/profile-form';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadOwnerProfile } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Owner' });
  return { title: t('stepNames.profile') };
}

export default async function OwnerProfilePage() {
  await requireSession('/owner/profile');
  const profile = await loadOwnerProfile();
  return (
    <AccountStepShell step="profile" available={profile !== null}>
      {profile ? <ProfileForm profile={profile} nextHref="/owner/tax" /> : null}
    </AccountStepShell>
  );
}
