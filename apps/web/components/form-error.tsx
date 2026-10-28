import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { CircleAlert } from 'lucide-react';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
