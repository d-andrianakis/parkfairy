'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import { saveOwnerTaxDetails } from '@parkfairy/api-client';
import {
  DEFAULT_COUNTRY,
  EU_COUNTRIES,
  OwnerTaxInputSchema,
  type OwnerProfile,
  type OwnerTaxInput,
} from '@parkfairy/contracts';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { SelectField, SelectOption, useCountryOptions, useOptionalLabel } from './fields';
import { StepActions } from './step-actions';

/**
 * Sensitive, so unlike other steps this one has no autosave: nothing is stored until the owner
 * presses the button, and saved values never come back to the page, only their last digits.
 */
export function TaxForm({ profile, nextHref }: { profile: OwnerProfile; nextHref: string }) {
  const t = useTranslations('Owner.tax');
  const locale = useLocale();
  const router = useRouter();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const invalid = useInvalidSubmitStatus();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const countries = useCountryOptions(EU_COUNTRIES, locale);
  const { tax, kind } = profile;
  const isBusiness = kind === 'business';

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<OwnerTaxInput>({
    resolver: zodResolver(OwnerTaxInputSchema) as unknown as Resolver<OwnerTaxInput>,
    // Masks are hints beside the field, never values in it: an empty field keeps what is saved.
    defaultValues: {
      taxCountry: tax.taxCountry,
      taxId: '',
      vatId: '',
      registrationNumber: '',
      birthDate: '',
    },
  });
  const country = watch('taxCountry');
  const isGreek = country === DEFAULT_COUNTRY;

  const savedHint = (ending: string | null) => (ending ? t('savedEnding', { ending }) : undefined);

  async function onSubmit(values: OwnerTaxInput) {
    if (saving) return;
    // What the schema can't know: what is already stored.
    const missing = [
      !values.taxId && !tax.taxIdEnding ? (['taxId', 'taxIdRequired'] as const) : null,
      !isBusiness && !values.birthDate && !tax.birthDateSaved
        ? (['birthDate', 'birthDateRequired'] as const)
        : null,
      isBusiness && !values.registrationNumber && !tax.registrationEnding
        ? (['registrationNumber', 'registrationRequired'] as const)
        : null,
    ].filter((entry) => entry !== null);
    if (missing.length > 0) {
      missing.forEach(([name, key], index) =>
        setError(name, { message: key }, { shouldFocus: index === 0 }),
      );
      invalid.onInvalid(
        Object.fromEntries(
          missing.map(([name, key]) => [name, { type: 'required', message: key }]),
        ),
      );
      return;
    }
    invalid.clear();
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(() => saveOwnerTaxDetails({ body: values }));
    if (outcome.ok) router.push(nextHref);
    else {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit, invalid.onInvalid)(event)} noValidate>
      <FieldGroup>
        {invalid.region}
        <SelectField
          id="taxCountry"
          label={t('country')}
          error={message(errors.taxCountry?.message)}
          {...register('taxCountry')}
        >
          {countries.map(({ code, name }) => (
            <SelectOption key={code} value={code}>
              {name}
            </SelectOption>
          ))}
        </SelectField>
        <FormField
          id="taxId"
          label={isGreek ? t('afm') : t('taxId')}
          hint={savedHint(tax.taxIdEnding) ?? (isGreek ? t('afmHint') : undefined)}
          inputMode={isGreek ? 'numeric' : 'text'}
          autoComplete="off"
          error={message(errors.taxId?.message)}
          {...register('taxId')}
        />
        {isBusiness ? (
          <FormField
            id="registrationNumber"
            label={t('registration')}
            hint={savedHint(tax.registrationEnding) ?? t('registrationHint')}
            autoComplete="off"
            error={message(errors.registrationNumber?.message)}
            {...register('registrationNumber')}
          />
        ) : (
          <FormField
            id="birthDate"
            label={t('birthDate')}
            hint={tax.birthDateSaved ? t('savedBirthDate') : undefined}
            type="date"
            autoComplete="bday"
            error={message(errors.birthDate?.message)}
            {...register('birthDate')}
          />
        )}
        <FormField
          id="vatId"
          label={optional(t('vatId'))}
          hint={savedHint(tax.vatIdEnding) ?? t('vatIdHint')}
          autoComplete="off"
          error={message(errors.vatId?.message)}
          {...register('vatId')}
        />
        <FormError message={failure} />
        <StepActions saving={saving} laterLabel={t('leave')} />
      </FieldGroup>
    </form>
  );
}
