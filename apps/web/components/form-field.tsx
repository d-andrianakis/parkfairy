import { FieldDescription, FieldLabel } from '@parkfairy/ui/components/field';
import { Input } from '@parkfairy/ui/components/input';
import type { ComponentProps, ReactNode } from 'react';
import { PlainField, PlainFieldError } from './plain-field';

interface FormFieldProps extends ComponentProps<typeof Input> {
  id: string;
  label: string;
  /** Persistent guidance shown under the field (e.g. password rules). */
  hint?: string;
  error?: string;
  /**
   * A control sitting inside the input, at its end; the input must leave room for it. Pass null
   * while it can't render yet: leaving it out changes the tree around the input, and React would
   * then replace the input, taking the focus and whatever is being typed with it.
   */
  endControl?: ReactNode;
}

/** Labelled input whose hint and validation message are announced with it. */
export function FormField({ id, label, hint, error, endControl, ...inputProps }: FormFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const input = (
    <Input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      {...inputProps}
    />
  );
  return (
    // One control per field: no wrapper group; the error is read with the field, not as an alert.
    <PlainField data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {endControl !== undefined ? (
        <div className="relative">
          {input}
          {endControl}
        </div>
      ) : (
        input
      )}
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      {error ? <PlainFieldError id={errorId}>{error}</PlainFieldError> : null}
    </PlainField>
  );
}
