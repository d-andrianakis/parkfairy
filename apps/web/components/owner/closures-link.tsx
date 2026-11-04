import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { closuresHref } from '@/lib/owner-href';

/** A sentence about a listing's closures and special hours, with the way there inside it. */
export function ClosuresLink({ id, lead }: { id: string; lead: 'hoursHint' | 'stillOpen' }) {
  const t = useTranslations('Owner.closures');
  return (
    <p className="text-sm">
      {t.rich(lead, {
        link: (chunks) => (
          <Link
            href={closuresHref(id)}
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
