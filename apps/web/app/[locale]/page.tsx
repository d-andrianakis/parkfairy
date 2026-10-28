import { Button } from '@parkfairy/ui/components/button';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function HomePage() {
  const t = await getTranslations('Home');
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 py-24">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">{t('title')}</h1>
      <p className="max-w-xl text-lg text-muted-foreground">{t('lead')}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/sign-up">{t('ctaSignUp')}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/sign-in">{t('ctaSignIn')}</Link>
        </Button>
      </div>
    </div>
  );
}
