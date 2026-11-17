'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AdminUserLookup, AdminUserLookupSchema } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { lookUpUser, useAdminError } from '@/lib/admin-client';
import { useValidationMessage } from '@/lib/use-validation-message';

/**
 * Finds one account by its whole address. The address goes in a request body and never in a URL,
 * where it would reach every log on the way (minimisation); the answer is the account's id, which
 * opens its page (and the page is what is logged).
 */
export function LookupForm() {
  const t = useTranslations('AdminLookup');
  const validationMessage = useValidationMessage();
  const adminError = useAdminError();
  const router = useRouter();
  // "No account has this address" belongs to the field, which takes the focus; an API refusal
  // (too many, no session) is about the form.
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<AdminUserLookup>({
    resolver: zodResolver(AdminUserLookupSchema),
    defaultValues: { email: '' },
  });
  const status = useInvalidSubmitStatus();

  const onSubmit = handleSubmit(async ({ email }) => {
    status.clear();
    setError(null);
    setNotFound(false);
    const outcome = await lookUpUser(email);
    if (!outcome.ok) {
      setError(adminError(outcome.failure, outcome.status));
      return;
    }
    if (!outcome.data.id) {
      setNotFound(true);
      status.say(t('notFound'));
      setFocus('email');
      return;
    }
    router.push(`/users/${outcome.data.id}`);
  }, status.onInvalid);

  // While a request is in flight, ignore further submits; the button stays focusable.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={error} />
        <FormField
          id="email"
          label={t('email')}
          type="email"
          autoComplete="off"
          spellCheck={false}
          aria-required="true"
          hint={t('hint')}
          error={validationMessage(errors.email?.message) ?? (notFound ? t('notFound') : undefined)}
          {...register('email', { onChange: () => setNotFound(false) })}
        />
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body>. */}
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
