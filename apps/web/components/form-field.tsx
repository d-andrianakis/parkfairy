import { Input } from '@parkfairy/ui/components/input';
import { Label } from '@parkfairy/ui/components/label';
import type { ComponentProps } from 'react';

interface FormFieldProps extends ComponentProps<typeof Input> {
  id: string;
  label: string;
  /** Persistent guidance shown under the field (e.g. password rules). */
  hint?: string;
  error?: string;
}

/** Labelled input whose hint and validation message are announced with it. */
export function FormField({ id, label, hint, error, ...inputProps }: FormFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
