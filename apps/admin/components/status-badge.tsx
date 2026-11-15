import type { ListingStatus } from '@parkfairy/api-client';
import { Badge } from '@parkfairy/ui/components/badge';
import { useTranslations } from 'next-intl';

/** A listing's status in words (never by colour alone, WCAG 1.4.1). */
export function StatusBadge({ status }: { status: ListingStatus }) {
  const t = useTranslations('Admin.status');
  return (
    <Badge
      variant={
        status === 'published' ? 'default' : status === 'suspended' ? 'destructive' : 'secondary'
      }
    >
      {t(status)}
    </Badge>
  );
}
