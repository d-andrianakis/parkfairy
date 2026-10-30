import { FieldDescription, FieldLabel } from '@parkfairy/ui/components/field';
import { Input } from '@parkfairy/ui/components/input';
import type { ComponentProps } from 'react';
import { PlainField, PlainFieldError } from './plain-field';

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
    // One control per field: no wrapper group; the error is read with the field, not as an alert.
    <PlainField data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      {error ? <PlainFieldError id={errorId}>{error}</PlainFieldError> : null}
    </PlainField>
  );
}
