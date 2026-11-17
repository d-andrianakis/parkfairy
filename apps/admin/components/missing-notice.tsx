import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Missing } from '@/lib/admin.server';

/** A page whose data didn't come: the API said no, or didn't answer. Said in words. */
export function MissingNotice({ reason }: { reason: Exclude<Missing, 'not-found'> }) {
  const t = useTranslations('Admin.missing');
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle className="line-clamp-none">{t(`${reason}.title`)}</AlertTitle>
      <AlertDescription>{t(`${reason}.text`)}</AlertDescription>
    </Alert>
  );
}
