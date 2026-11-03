'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateOwnerProfile } from '@parkfairy/api-client';
import {
  EU_COUNTRIES,
  OWNER_KINDS,
  OwnerProfileInputSchema,
  OwnerProfilePatchSchema,
  type OwnerKind,
  type OwnerProfile,
  type OwnerProfileInput,
  type OwnerProfilePatch,
} from '@parkfairy/contracts';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { ChoiceField, SelectField, SelectOption, useCountryOptions } from './fields';
import { SaveStatus, useAutosave } from './save-status';
import { StepActions } from './step-actions';

type FieldName = keyof OwnerProfilePatch;

export function ProfileForm({ profile, nextHref }: { profile: OwnerProfile; nextHref: string }) {
  const t = useTranslations('Owner.profile');
  const locale = useLocale();
  const router = useRouter();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const invalid = useInvalidSubmitStatus();
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const countries = useCountryOptions(EU_COUNTRIES, locale);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    watch,
    formState: { errors },
  } = useForm<OwnerProfileInput>({
    resolver: zodResolver(OwnerProfileInputSchema) as unknown as Resolver<OwnerProfileInput>,
    defaultValues: {
      kind: profile.kind ?? undefined,
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      legalName: profile.legalName ?? '',
      phone: profile.phone ?? '',
      addressLine: profile.addressLine ?? '',
      city: profile.city ?? '',
      postalCode: profile.postalCode ?? '',
      country: profile.country,
    },
  });

  const { state, autosave, remember, settled } = useAutosave(async (name, value) => {
    const outcome = await attempt(() =>
      updateOwnerProfile({ body: { [name]: value } as OwnerProfilePatch }),
    );
    return outcome.ok;
  });

  useEffect(() => {
    for (const [name, value] of Object.entries(getValues())) remember(name, value);
  }, [getValues, remember]);

  /** Valid fields are kept as they are left; the rest wait for the owner to finish typing. */
  function saveField(name: FieldName) {
    const value = getValues(name as keyof OwnerProfileInput);
    if (OwnerProfilePatchSchema.safeParse({ [name]: value }).success) autosave(name, value);
  }
  const registerSaved = (name: FieldName & keyof OwnerProfileInput) =>
    register(name, { onBlur: () => saveField(name) });

  const isBusiness = watch('kind') === 'business';

  async function onSubmit(values: OwnerProfileInput) {
    if (saving) return;
    invalid.clear();
    setSaving(true);
    setFailure(null);
    await settled();
    const outcome = await attempt(() => updateOwnerProfile({ body: values as OwnerProfilePatch }));
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
        <Controller
          name="kind"
          control={control}
          render={({ field: { value, onChange, ref } }) => (
            <ChoiceField<OwnerKind>
              id="kind"
              firstRef={ref}
              legend={t('kind')}
              value={value}
              onChange={(next) => {
                onChange(next);
                autosave('kind', next);
              }}
              error={message(errors.kind?.message)}
              choices={OWNER_KINDS.map((kind) => ({
                value: kind,
                label: t(`kinds.${kind}.label`),
                description: t(`kinds.${kind}.text`),
              }))}
            />
          )}
        />
        {isBusiness ? (
          <FormField
            id="legalName"
            label={t('legalName')}
            hint={t('legalNameHint')}
            autoComplete="organization"
            error={message(errors.legalName?.message)}
            {...registerSaved('legalName')}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="firstName"
              label={t('firstName')}
              autoComplete="given-name"
              error={message(errors.firstName?.message)}
              {...registerSaved('firstName')}
            />
            <FormField
              id="lastName"
              label={t('lastName')}
              autoComplete="family-name"
              error={message(errors.lastName?.message)}
              {...registerSaved('lastName')}
            />
          </div>
        )}
        <FormField
          id="phone"
          label={t('phone')}
          hint={t('phoneHint')}
          type="tel"
          autoComplete="tel"
          error={message(errors.phone?.message)}
          {...registerSaved('phone')}
        />
        <FormField
          id="addressLine"
          label={t('addressLine')}
          autoComplete="street-address"
          error={message(errors.addressLine?.message)}
          {...registerSaved('addressLine')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="city"
            label={t('city')}
            autoComplete="address-level2"
            error={message(errors.city?.message)}
            {...registerSaved('city')}
          />
          <FormField
            id="postalCode"
            label={t('postalCode')}
            autoComplete="postal-code"
            error={message(errors.postalCode?.message)}
            {...registerSaved('postalCode')}
          />
        </div>
        <SelectField
          id="country"
          label={t('country')}
          autoComplete="country"
          error={message(errors.country?.message)}
          {...registerSaved('country')}
        >
          {countries.map(({ code, name }) => (
            <SelectOption key={code} value={code}>
              {name}
            </SelectOption>
          ))}
        </SelectField>
        <SaveStatus state={state} />
        <FormError message={failure} />
        <StepActions saving={saving} />
      </FieldGroup>
    </form>
  );
}
