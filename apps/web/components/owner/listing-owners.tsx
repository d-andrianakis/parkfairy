'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  inviteListingOwner,
  leaveListing,
  removeListingOwner,
  setListingShares,
  withdrawListingInvite,
  type ListingOwners,
} from '@parkfairy/api-client';
import {
  DEFAULT_TIME_ZONE,
  LISTING_INVITE_DAYS,
  ListingInviteInputSchema,
  ListingSharesInputSchema,
  type ListingSharesInput,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Badge } from '@parkfairy/ui/components/badge';
import { Button } from '@parkfairy/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@parkfairy/ui/components/card';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { CircleAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { useFocusAfterRender } from './navigation';

/** Shares as people read them: whole percents, in the page's language ("70%", "70 %"). */
const PERCENT = { style: 'percent', maximumFractionDigits: 0 } as const;

/** What the invite form asks for; the language the email is written in is the page's. */
const InviteFormSchema = ListingInviteInputSchema.pick({ email: true });
type InviteForm = z.infer<typeof InviteFormSchema>;

/** A polite region saying what was just done, cleared first so the same words are said again. */
function useDone() {
  const [said, setSaid] = useState('');
  return {
    say(text: string) {
      setSaid('');
      requestAnimationFrame(() => setSaid(text));
    },
    region: (
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {said}
      </p>
    ),
  };
}

/**
 * A listing's owners (#53–#56): who they are, their shares and whether Stripe can pay them;
 * invites to join, and those still waiting. Every owner may invite; the primary sets the shares and
 * removes co-owners; a co-owner may leave. Each change answers with the owners as they now are.
 */
export function ListingOwnersPanel({ initial }: { initial: ListingOwners }) {
  const [owners, setOwners] = useState(initial);
  const t = useTranslations('Owner.owners');
  const done = useDone();
  const primary = owners.role === 'primary';

  return (
    <div className="grid gap-6">
      {done.region}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('sharesTitle')}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('sharesLead')}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {owners.payable ? null : (
            <Alert>
              <CircleAlert aria-hidden />
              <AlertDescription>{t('notPayable')}</AlertDescription>
            </Alert>
          )}
          {primary ? (
            <SharesForm owners={owners} onSaved={setOwners} said={done.say} />
          ) : (
            <OwnerList owners={owners} />
          )}
          {primary ? (
            <RemoveOwners owners={owners} onChanged={setOwners} said={done.say} />
          ) : (
            <LeaveListing listingId={owners.listingId} />
          )}
        </CardContent>
      </Card>
      <InviteOwner owners={owners} onInvited={setOwners} said={done.say} />
      {owners.invites.length > 0 ? (
        <OpenInvites owners={owners} onChanged={setOwners} said={done.say} />
      ) : null}
    </div>
  );
}

/** Each owner, as one line of facts: name, role, share, payouts. */
function OwnerFacts({ owner }: { owner: ListingOwners['owners'][number] }) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const name = owner.name ?? owner.email;
  return (
    <div className="grid gap-1">
      <p className="font-medium wrap-anywhere">{owner.you ? t('you', { name }) : name}</p>
      <p className="text-sm wrap-anywhere text-muted-foreground">{owner.email}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{t(`role.${owner.role}`)}</Badge>
        <span>{t('share', { percent: format.number(owner.sharePercent / 100, PERCENT) })}</span>
        <span className="text-muted-foreground">{t(`payouts.${owner.payouts}`)}</span>
      </div>
    </div>
  );
}

function OwnerList({ owners }: { owners: ListingOwners }) {
  return (
    <ul className="grid gap-4">
      {owners.owners.map((owner) => (
        <li key={owner.id}>
          <OwnerFacts owner={owner} />
        </li>
      ))}
    </ul>
  );
}

/** The primary's: every owner's share at once, whole percents adding up to 100 (#54). */
function SharesForm({
  owners,
  onSaved,
  said,
}: {
  owners: ListingOwners;
  onSaved: (owners: ListingOwners) => void;
  said: (text: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const validation = useValidationMessage();
  const ownerError = useOwnerError();
  const status = useInvalidSubmitStatus();
  const [failure, setFailure] = useState<string | null>(null);
  const shares = () =>
    owners.owners.map((owner) => ({ ownerId: owner.id, percent: owner.sharePercent }));
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ListingSharesInput>({
    resolver: zodResolver(ListingSharesInputSchema),
    defaultValues: { shares: shares() },
  });
  // The owners changed (one removed, or left): the form follows them.
  useEffect(() => {
    reset({ shares: owners.owners.map((o) => ({ ownerId: o.id, percent: o.sharePercent })) });
  }, [owners.owners, reset]);
  const watched = useWatch({ control, name: 'shares' });
  const total = (watched ?? []).reduce(
    (sum, share) => sum + (Number.isFinite(share.percent) ? share.percent : 0),
    0,
  );

  const onSubmit = handleSubmit(async (input) => {
    status.clear();
    setFailure(null);
    const outcome = await attempt(() =>
      setListingShares({ path: { id: owners.listingId }, body: input }),
    );
    if (outcome.ok && outcome.data) {
      onSaved(outcome.data);
      said(t('sharesSaved'));
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }, status.onInvalid);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };
  // The total's own message, from the list's check (`sharesTotal`).
  const listError = errors.shares?.root?.message ?? errors.shares?.message;

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={failure ?? validation(listError) ?? null} />
        <ul className="grid gap-6">
          {owners.owners.map((owner, index) => (
            <li key={owner.id} className="grid gap-3">
              <OwnerFacts owner={owner} />
              <input type="hidden" {...register(`shares.${index}.ownerId`)} />
              <FormField
                id={`share-${owner.id}`}
                label={t('shareLabel', { name: owner.name ?? owner.email })}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                className="w-28"
                error={validation(errors.shares?.[index]?.percent?.message)}
                {...register(`shares.${index}.percent`, { valueAsNumber: true })}
              />
            </li>
          ))}
        </ul>
        <p className="text-sm" aria-live="polite">
          {t('total', { total: format.number(total / 100, PERCENT) })}
        </p>
        <div>
          <Button
            type="submit"
            className={WRAPPING_BUTTON}
            aria-disabled={isSubmitting || undefined}
          >
            {isSubmitting ? t('saving') : t('saveShares')}
          </Button>
        </div>
      </FieldGroup>
      {status.region}
    </form>
  );
}

/** Two presses for each, in place: removing an owner can't be undone. */
function RemoveOwners({
  owners,
  onChanged,
  said,
}: {
  owners: ListingOwners;
  onChanged: (owners: ListingOwners) => void;
  said: (text: string) => void;
}) {
  const coOwners = owners.owners.filter((owner) => owner.role === 'co_owner');
  if (coOwners.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {coOwners.map((owner) => (
        <li key={owner.id}>
          <RemoveOwner
            listingId={owners.listingId}
            owner={owner}
            onChanged={onChanged}
            said={said}
          />
        </li>
      ))}
    </ul>
  );
}

function RemoveOwner({
  listingId,
  owner,
  onChanged,
  said,
}: {
  listingId: string;
  owner: ListingOwners['owners'][number];
  onChanged: (owners: ListingOwners) => void;
  said: (text: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const name = owner.name ?? owner.email;
  return (
    <TwoPresses
      id={`remove-${owner.id}`}
      label={t('remove', { name })}
      question={t('removeQuestion', { name })}
      confirm={t('removeConfirm')}
      act={() => removeListingOwner({ path: { id: listingId, ownerId: owner.id } })}
      onDone={(answer) => {
        if (answer) onChanged(answer);
        said(t('removed', { name }));
      }}
    />
  );
}

function LeaveListing({ listingId }: { listingId: string }) {
  const t = useTranslations('Owner.owners');
  const router = useRouter();
  return (
    <TwoPresses
      id="leave-listing"
      label={t('leave')}
      question={t('leaveQuestion')}
      confirm={t('leaveConfirm')}
      act={() => leaveListing({ path: { id: listingId } })}
      // Theirs no more: back to their own listings.
      onDone={() => router.replace('/owner')}
    />
  );
}

/**
 * A destructive press asked twice, as deleting a draft is: the question takes the focus, which is
 * what makes it read out; keeping puts the focus back on the button.
 */
function TwoPresses<T>({
  id,
  label,
  question,
  confirm,
  act,
  onDone,
}: {
  id: string;
  label: string;
  question: string;
  confirm: string;
  act: () => Promise<{ data?: T; error?: unknown; response?: Response }>;
  onDone: (answer: T | undefined) => void;
}) {
  const t = useTranslations('Owner.owners');
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const asked = useRef<HTMLParagraphElement>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (asking) asked.current?.focus();
  }, [asking]);

  async function go() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const outcome = await attempt(act);
    setSaving(false);
    if (outcome.ok) {
      setAsking(false);
      onDone(outcome.data);
    } else setFailure(ownerError(outcome.failure));
  }

  if (!asking) {
    return (
      <Button
        id={id}
        type="button"
        variant="outline"
        size="sm"
        className={WRAPPING_BUTTON}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="grid gap-2">
      <FormError message={failure} />
      <p
        ref={asked}
        tabIndex={-1}
        className="rounded-sm text-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className={WRAPPING_BUTTON}
          aria-disabled={saving || undefined}
          onClick={() => void go()}
        >
          {confirm}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAsking(false);
            setFailure(null);
            focusAfter(id);
          }}
        >
          {t('keep')}
        </Button>
      </div>
    </div>
  );
}

/** Any owner invites by email (#56); the email goes in the page's language. */
function InviteOwner({
  owners,
  onInvited,
  said,
}: {
  owners: ListingOwners;
  onInvited: (owners: ListingOwners) => void;
  said: (text: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const locale = useLocale();
  const validation = useValidationMessage();
  const ownerError = useOwnerError();
  const status = useInvalidSubmitStatus();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({ resolver: zodResolver(InviteFormSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    status.clear();
    setFailure(null);
    const outcome = await attempt(() =>
      inviteListingOwner({
        path: { id: owners.listingId },
        body: { email, locale: locale === 'el' ? 'el' : 'en' },
      }),
    );
    if (outcome.ok && outcome.data) {
      onInvited(outcome.data);
      reset({ email: '' });
      said(t('invited', { email }));
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }, status.onInvalid);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('inviteTitle')}</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('inviteLead', { days: LISTING_INVITE_DAYS })}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">{t('room', { count: owners.room })}</p>
        {owners.room > 0 ? (
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <FormError message={failure} />
              <FormField
                id="invite-email"
                label={t('email')}
                type="email"
                autoComplete="off"
                error={validation(errors.email?.message)}
                {...register('email')}
              />
              <div>
                <Button
                  type="submit"
                  className={WRAPPING_BUTTON}
                  aria-disabled={isSubmitting || undefined}
                >
                  {isSubmitting ? t('sending') : t('sendInvite')}
                </Button>
              </div>
            </FieldGroup>
            {status.region}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenInvites({
  owners,
  onChanged,
  said,
}: {
  owners: ListingOwners;
  onChanged: (owners: ListingOwners) => void;
  said: (text: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const ownerError = useOwnerError();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function withdraw(inviteId: string, email: string) {
    if (busy) return;
    setBusy(inviteId);
    setFailure(null);
    const outcome = await attempt(() =>
      withdrawListingInvite({ path: { id: owners.listingId, inviteId } }),
    );
    setBusy(null);
    if (outcome.ok && outcome.data) {
      onChanged(outcome.data);
      said(t('withdrawn', { email }));
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('invitesTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={failure} />
        <ul className="grid gap-4">
          {owners.invites.map((invite) => (
            <li key={invite.id} className="grid gap-1">
              <p className="font-medium wrap-anywhere">{invite.email}</p>
              <p className="text-sm text-muted-foreground">
                {invite.expiresAt
                  ? t('inviteUntil', {
                      date: format.dateTime(new Date(invite.expiresAt), {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: DEFAULT_TIME_ZONE,
                      }),
                    })
                  : t('inviteSending')}
                {invite.invitedBy ? ` · ${t('invitedBy', { name: invite.invitedBy })}` : null}
              </p>
              {invite.canWithdraw ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={WRAPPING_BUTTON}
                    aria-disabled={busy === invite.id || undefined}
                    onClick={() => void withdraw(invite.id, invite.email)}
                  >
                    {t('withdraw', { email: invite.email })}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
