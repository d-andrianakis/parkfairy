'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AdminBookingLookup, AdminBookingLookupSchema } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { lookUpBooking, useAdminError } from '@/lib/admin-client';
import { useValidationMessage } from '@/lib/use-validation-message';

/**
 * Finds one booking by the reference a driver quotes. The reference goes in a request body, never a
 * URL; the answer is the booking's id, which opens its page (and the page is what is logged, #85).
 */
export function BookingLookupForm() {
  const t = useTranslations('AdminBookingLookup');
  const validationMessage = useValidationMessage();
  const adminError = useAdminError();
  const router = useRouter();
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<AdminBookingLookup>({
    resolver: zodResolver(AdminBookingLookupSchema),
    defaultValues: { reference: '' },
  });
  const status = useInvalidSubmitStatus();

  const onSubmit = handleSubmit(async ({ reference }) => {
    status.clear();
    setError(null);
    setNotFound(false);
    const outcome = await lookUpBooking(reference);
    if (!outcome.ok) {
      setError(adminError(outcome.failure, outcome.status));
      return;
    }
    if (!outcome.data.id) {
      setNotFound(true);
      status.say(t('notFound'));
      setFocus('reference');
      return;
    }
    router.push(`/bookings/${outcome.data.id}`);
  }, status.onInvalid);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={error} />
        <FormField
          id="reference"
          label={t('reference')}
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-required="true"
          hint={t('hint')}
          error={
            validationMessage(errors.reference?.message) ?? (notFound ? t('notFound') : undefined)
          }
          {...register('reference', { onChange: () => setNotFound(false) })}
        />
        <div>
          <Button type="submit" aria-disabled={isSubmitting || undefined}>
            {isSubmitting ? t('busy') : t('submit')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}
