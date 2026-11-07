'use client';

import { Checkbox } from '@parkfairy/ui/components/checkbox';
import {
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@parkfairy/ui/components/field';
import { Label } from '@parkfairy/ui/components/label';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { RadioGroup, RadioGroupItem } from '@parkfairy/ui/components/radio-group';
import { Textarea } from '@parkfairy/ui/components/textarea';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { PlainField, PlainFieldError } from '@/components/plain-field';

interface Described {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

function describedBy({ id, hint, error }: Described) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.join(' ') || undefined;
}

function Below({ id, hint, error }: Described) {
  return (
    <>
      {hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
      {error ? <PlainFieldError id={`${id}-error`}>{error}</PlainFieldError> : null}
    </>
  );
}

type SelectProps = Described & ComponentProps<typeof NativeSelect>;

/** A labelled list, wired like `FormField`. */
export function SelectField({ id, label, hint, error, children, ...selectProps }: SelectProps) {
  return (
    <PlainField data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, label, hint, error })}
        {...selectProps}
      >
        {children}
      </NativeSelect>
      <Below id={id} label={label} hint={hint} error={error} />
    </PlainField>
  );
}

export { NativeSelectOption as SelectOption };

type TextareaProps = Described & ComponentProps<typeof Textarea>;

/** A labelled text area, wired like `FormField`. */
export function TextareaField({ id, label, hint, error, ...textareaProps }: TextareaProps) {
  return (
    <PlainField data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, label, hint, error })}
        {...textareaProps}
      />
      <Below id={id} label={label} hint={hint} error={error} />
    </PlainField>
  );
}

interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
  /** Spoken name, when the visible label needs the row's context. */
  ariaLabel?: string;
  disabled?: boolean;
}

/** A checkbox with its label beside it; the whole label is a target (WCAG 2.5.8). */
export function CheckboxField({
  id,
  label,
  checked,
  onChange,
  error,
  ariaLabel,
  disabled,
}: CheckboxFieldProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-0.5"
      />
      {/* min-w-0: a long name in the label wraps rather than pushing past the screen. */}
      <div className="grid min-w-0 gap-1">
        <Label htmlFor={id} className="leading-snug font-normal">
          {label}
        </Label>
        {error ? <PlainFieldError id={`${id}-error`}>{error}</PlainFieldError> : null}
      </div>
    </div>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface ChoiceFieldProps<T extends string> {
  id: string;
  legend: string;
  hint?: string;
  choices: Choice<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  error?: string | undefined;
  /** Lets a form move the focus here: goes on the first radio. */
  firstRef?: Ref<HTMLButtonElement>;
}

/** One choice out of a few, each with room to explain itself. */
export function ChoiceField<T extends string>({
  id,
  legend,
  hint,
  choices,
  value,
  onChange,
  error,
  firstRef,
}: ChoiceFieldProps<T>) {
  return (
    <FieldSet>
      <FieldLegend id={`${id}-legend`} variant="label">
        {legend}
      </FieldLegend>
      {hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
      <RadioGroup
        value={value ?? ''}
        onValueChange={(next) => onChange(next as T)}
        aria-labelledby={`${id}-legend`}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {choices.map((choice, index) => (
          <div key={choice.value} className="flex items-start gap-2">
            <RadioGroupItem
              id={`${id}-${choice.value}`}
              ref={index === 0 ? firstRef : undefined}
              value={choice.value}
              aria-invalid={error ? true : undefined}
              // The error is read from each radio, because that is where the focus lands.
              aria-describedby={
                [
                  choice.description ? `${id}-${choice.value}-text` : null,
                  error ? `${id}-error` : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              className="mt-0.5"
            />
            <div className="grid gap-0.5">
              <Label htmlFor={`${id}-${choice.value}`} className="leading-snug font-normal">
                {choice.label}
              </Label>
              {choice.description ? (
                <p id={`${id}-${choice.value}-text`} className="text-sm text-muted-foreground">
                  {choice.description}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </RadioGroup>
      {error ? <PlainFieldError id={`${id}-error`}>{error}</PlainFieldError> : null}
    </FieldSet>
  );
}

/** The country names of the viewer's language, sorted as they read them. */
export function useCountryOptions(countries: readonly string[], locale: string) {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return countries
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** "Optional" beside a label, so required needs no marking at all. */
export function useOptionalLabel() {
  const t = useTranslations('Owner');
  return (label: string) => t('optional', { label });
}
