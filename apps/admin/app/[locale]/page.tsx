import { redirect } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';

/** There is no home page: staff land on the queue, and signing in is asked there. */
export default async function HomePage({ params }: LocaleParams) {
  redirect({ href: '/listings', locale: await localeFromParams(params) });
}
