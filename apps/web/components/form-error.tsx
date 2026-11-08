import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** A form's refusal; `children` is where to go about it, e.g. a link, inside the same alert. */
export function FormError({ message, children }: { message: string | null; children?: ReactNode }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        <p>{message}</p>
        {children}
      </AlertDescription>
    </Alert>
  );
}
