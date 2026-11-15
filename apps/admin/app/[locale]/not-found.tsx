import { Button } from '@parkfairy/ui/components/button';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function NotFoundPage() {
  const t = await getTranslations('NotFound');
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <title>{t('metaTitle')}</title>
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button asChild>
        <Link href="/">{t('home')}</Link>
      </Button>
    </div>
  );
}
