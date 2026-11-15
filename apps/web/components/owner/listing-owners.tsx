'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  acceptListingHandover,
  inviteListingOwner,
  leaveListing,
  offerListingHandover,
  removeListingOwner,
  setListingShares,
  withdrawListingHandover,
  withdrawListingInvite,
  type ListingOwners,
} from '@parkfairy/api-client';
import {
  LISTING_INVITE_DAYS,
  LISTING_OWNERS_MAX,
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
import { hasLocale, useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FocusHeading } from '@/components/focus-heading';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { PersonName } from '@/components/parking/place-words';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { timeOptions } from '@/i18n/formats';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { useFocusAfterRender } from './navigation';

/** Shares as people read them: whole percents, in the page's language ("70%"). */
const PERCENT = { style: 'percent', maximumFractionDigits: 0 } as const;

/** What the invite form asks for; the language the email is written in is the page's. */
const InviteFormSchema = ListingInviteInputSchema.pick({ email: true });
type InviteForm = z.infer<typeof InviteFormSchema>;

/** Where the focus goes when what had it is gone (an owner removed, an invite withdrawn). */
const OWNERS_HEADING = 'listing-owners-heading';
const INVITE_HEADING = 'listing-invite-heading';
const INVITES_HEADING = 'listing-invites-heading';
const HANDOVER_HEADING = 'listing-handover-heading';
/** Focusable for those moves, with the ring the focus shows. */
const FOCUS_TARGET =
  'rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50';

type Owner = ListingOwners['owners'][number];
const nameOf = (owner: Owner) => owner.name ?? owner.email ?? '';

/**
 * A listing's owners (#53–#56): who they are, their shares and whether Stripe can pay them;
 * invites to join, and those still waiting. Every owner may invite; the primary sets the shares and
 * removes co-owners; a co-owner may leave. Each change answers with the owners as they now are,
 * and says so in a region that is always there; the focus goes somewhere that stays.
 */
export function ListingOwnersPanel({ initial }: { initial: ListingOwners }) {
  const [owners, setOwners] = useState(initial);
  const [left, setLeft] = useState(false);
  const t = useTranslations('Owner.owners');
  const locale = useLocale();
  const done = useAnnouncer('text-sm wrap-anywhere text-muted-foreground empty:sr-only');
  // Answers can take a while: whoever has moved on meanwhile keeps their place.
  const focus = useFocusAfterRender({ onlyIfLost: true });
  const primary = owners.role === 'primary';

  if (left) {
    return (
      <div className="grid gap-3">
        {/* The tab says it too: the page it named is no longer theirs. */}
        <FocusHeading retitle>{t('left')}</FocusHeading>
        <div>
          <Button asChild variant="outline" className={WRAPPING_BUTTON}>
            <Link href="/owner">{t('backToListings')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {done.region}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={OWNERS_HEADING} tabIndex={-1} className={FOCUS_TARGET}>
              {t('sharesTitle')}
            </h2>
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
            <SharesForm owners={owners} onSaved={setOwners} said={done.announce} />
          ) : (
            <OwnerList owners={owners} />
          )}
          {primary ? (
            <RemoveOwners
              owners={owners}
              onRemoved={(answer, name) => {
                setOwners(answer);
                done.announce(
                  t.rich('removed', {
                    name,
                    person: () => <PersonName name={name} lang={locale} />,
                  }),
                );
                focus(OWNERS_HEADING);
              }}
            />
          ) : (
            <LeaveListing listingId={owners.listingId} onLeft={() => setLeft(true)} />
          )}
        </CardContent>
      </Card>
      <Handover
        owners={owners}
        onChanged={(answer, said, next) => {
          setOwners(answer);
          done.announce(said);
          focus(next);
        }}
      />
      <InviteOwner
        owners={owners}
        onInvited={(answer, email) => {
          setOwners(answer);
          done.announce(t('invited', { email }));
          // The form went with the last place: the focus to the section's heading.
          if (answer.room === 0) focus(INVITE_HEADING);
        }}
      />
      {owners.invites.length > 0 ? (
        <OpenInvites
          owners={owners}
          onWithdrawn={(answer, email, next) => {
            setOwners(answer);
            done.announce(t('withdrawn', { email }));
            focus(next);
          }}
        />
      ) : null}
    </div>
  );
}

/** Each owner, as a few facts: name, role, share, and payouts where the asker may see them. */
function OwnerFacts({ owner }: { owner: Owner }) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const locale = useLocale();
  const person = () => <PersonName name={nameOf(owner)} lang={locale} />;
  return (
    <div className="grid gap-1">
      <p className="font-medium wrap-anywhere">
        {owner.you ? t.rich('you', { name: nameOf(owner), person }) : person()}
      </p>
      {owner.email ? (
        <p className="text-sm wrap-anywhere text-muted-foreground">{owner.email}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{t(`role.${owner.role}`)}</Badge>
        <span>{t('share', { percent: format.number(owner.sharePercent / 100, PERCENT) })}</span>
        {owner.payouts ? (
          <span className="text-muted-foreground">{t(`payouts.${owner.payouts}`)}</span>
        ) : null}
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
  said: (text: ReactNode) => void;
}) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const locale = useLocale();
  const validation = useValidationMessage();
  const ownerError = useOwnerError();
  const status = useInvalidSubmitStatus();
  const [failure, setFailure] = useState<string | null>(null);
  /** Owners whose share the API refused until their details are in: said at their field. */
  const [unreported, setUnreported] = useState<ReadonlySet<string>>(() => new Set());
  const {
    register,
    handleSubmit,
    reset,
    control,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ListingSharesInput>({
    resolver: zodResolver(ListingSharesInputSchema),
    defaultValues: {
      shares: owners.owners.map((o) => ({ ownerId: o.id, percent: o.sharePercent })),
    },
  });
  // The owners changed (one removed, or joined): the form follows them, keeping what was typed
  // for those still here. Any other answer (an invite sent) leaves the fields alone.
  const ids = owners.owners.map((owner) => owner.id).join(',');
  const saved = useMemo(
    () => new Map(owners.owners.map((owner) => [owner.id, owner.sharePercent])),
    [owners.owners],
  );
  const shown = useRef(ids);
  useEffect(() => {
    if (shown.current === ids) return;
    shown.current = ids;
    const typed = new Map(getValues('shares').map((share) => [share.ownerId, share.percent]));
    reset({
      shares: ids
        .split(',')
        .map((id) => ({ ownerId: id, percent: typed.get(id) ?? saved.get(id) ?? 0 })),
    });
  }, [ids, saved, getValues, reset]);
  const watched = useWatch({ control, name: 'shares' });
  const total = (watched ?? []).reduce(
    (sum, share) => sum + (Number.isFinite(share.percent) ? share.percent : 0),
    0,
  );

  const onSubmit = handleSubmit(
    async (input) => {
      status.clear();
      setFailure(null);
      setUnreported(new Set());
      const outcome = await attempt(() =>
        setListingShares({ path: { id: owners.listingId }, body: input }),
      );
      if (outcome.ok && outcome.data) {
        onSaved(outcome.data);
        said(t('sharesSaved'));
        return;
      }
      const refused = outcome.ok ? {} : outcome.failure;
      setFailure(ownerError(refused));
      if (refused.code === 'OWNER_DETAILS_MISSING') setUnreported(new Set(refused.owners ?? []));
    },
    (found) => {
      const fields = Array.isArray(found.shares)
        ? found.shares.filter((share) => share !== undefined).length
        : 0;
      // The list's own check (the total) names no field: what's wrong is said as it is.
      if (fields > 0) status.report(fields);
      else
        status.say(
          validation(found.shares?.root?.message ?? found.shares?.message) ?? t('sharesHint'),
        );
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) event.preventDefault();
    else void onSubmit(event);
  };
  // The total's own message, from the list's check (`sharesTotal`).
  const totalError = validation(errors.shares?.root?.message ?? errors.shares?.message);

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={failure} />
        <p id="shares-hint" className="text-sm text-muted-foreground">
          {t('sharesHint')}
        </p>
        <ul className="grid gap-6">
          {owners.owners.map((owner, index) => {
            const name = nameOf(owner);
            const person = () => <PersonName name={name} lang={locale} />;
            const waits = unreported.has(owner.id)
              ? owner.you
                ? t.rich('shareNeedsYourDetails', {
                    profile: (chunks) => (
                      <Link href="/owner/profile" className="underline underline-offset-4">
                        {chunks}
                      </Link>
                    ),
                    tax: (chunks) => (
                      <Link href="/owner/tax" className="underline underline-offset-4">
                        {chunks}
                      </Link>
                    ),
                  })
                : t.rich('shareNeedsDetails', { name, person })
              : null;
            const own = validation(errors.shares?.[index]?.percent?.message) ?? waits;
            return (
              <li key={owner.id} className="grid gap-3">
                <OwnerFacts owner={owner} />
                <input type="hidden" {...register(`shares.${index}.ownerId`)} />
                <FormField
                  id={`share-${owner.id}`}
                  label={t.rich('shareLabel', { name, person })}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  className="w-28"
                  hint={t('percentUnit')}
                  error={own ?? undefined}
                  // The total's error is each field's too: any of them may be what's wrong.
                  aria-invalid={own || totalError ? true : undefined}
                  aria-describedby={[
                    'shares-hint',
                    `share-${owner.id}-hint`,
                    own ? `share-${owner.id}-error` : null,
                    'shares-total',
                    totalError ? 'shares-total-error' : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  {...register(`shares.${index}.percent`, { valueAsNumber: true })}
                />
              </li>
            );
          })}
        </ul>
        <div className="grid gap-1">
          <p id="shares-total" className="text-sm">
            {t('total', { total: format.number(total / 100, PERCENT) })}
          </p>
          {/* Read with each field it is about, not as an alert over them; the summary says it. */}
          {totalError ? (
            <p id="shares-total-error" className="text-sm text-destructive">
              {totalError}
            </p>
          ) : null}
        </div>
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

/**
 * Handing the primary role to a co-owner, in two steps: the primary offers, the co-owner accepts.
 * Nothing changes until then. The offer, its end and what each owner may do about it come from the
 * API; every press is asked twice, and each answer says what happened and where the focus goes.
 */
function Handover({
  owners,
  onChanged,
}: {
  owners: ListingOwners;
  onChanged: (owners: ListingOwners, said: ReactNode, focusId: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const locale = useLocale();
  const offer = owners.handover;
  const primary = owners.role === 'primary';
  const coOwners = owners.owners.filter((owner) => owner.role === 'co_owner');
  const offered = offer ? owners.owners.find((owner) => owner.id === offer.toOwnerId) : undefined;
  // Nothing to say to a co-owner when there is no offer, and nobody to offer it to otherwise.
  if (!offer && (!primary || coOwners.length === 0)) return null;
  const nameOfOffered = offered ? nameOf(offered) : '';
  const until = offer
    ? format.dateTime(new Date(offer.expiresAt), {
        day: 'numeric',
        month: 'long',
        ...timeOptions(locale),
      })
    : '';
  const time = (chunks: ReactNode) => <time dateTime={offer?.expiresAt ?? ''}>{chunks}</time>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={HANDOVER_HEADING} tabIndex={-1} className={FOCUS_TARGET}>
            {t('handoverTitle')}
          </h2>
        </CardTitle>
        {primary && !offer ? (
          <p className="text-sm text-muted-foreground">{t('handoverLead')}</p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        {offer ? (
          <p className="text-sm wrap-anywhere">
            {offer.canAccept
              ? t.rich('handoverPendingYou', { date: until, time })
              : t.rich('handoverPending', {
                  name: nameOfOffered,
                  date: until,
                  person: () => <PersonName name={nameOfOffered} lang={locale} />,
                  time,
                })}
          </p>
        ) : null}
        {offer?.canAccept ? (
          <TwoPresses
            id="handover-accept"
            label={t('handoverAccept')}
            question={t('handoverAcceptQuestion')}
            confirm={t('handoverAcceptConfirm')}
            keep={t('keepOffer')}
            act={() => acceptListingHandover({ path: { id: owners.listingId } })}
            onDone={(answer) => {
              if (answer) onChanged(answer, t('handoverAccepted'), OWNERS_HEADING);
            }}
          />
        ) : null}
        {offer?.canWithdraw ? (
          <TwoPresses
            id="handover-withdraw"
            label={offer.canAccept ? t('handoverDecline') : t('handoverWithdraw')}
            question={
              offer.canAccept ? t('handoverDeclineQuestion') : t('handoverWithdrawQuestion')
            }
            confirm={offer.canAccept ? t('handoverDeclineConfirm') : t('handoverWithdrawConfirm')}
            keep={t('keepOffer')}
            act={() => withdrawListingHandover({ path: { id: owners.listingId } })}
            onDone={(answer) => {
              if (answer) onChanged(answer, t('handoverClosed'), HANDOVER_HEADING);
            }}
          />
        ) : null}
        {primary && !offer ? (
          <ul className="grid gap-2">
            {coOwners.map((owner) => {
              const name = nameOf(owner);
              return (
                <li key={owner.id}>
                  <TwoPresses
                    id={`handover-offer-${owner.id}`}
                    label={t.rich('handoverOffer', {
                      name,
                      person: () => <PersonName name={name} lang={locale} />,
                    })}
                    question={t.rich('handoverOfferQuestion', {
                      name,
                      person: () => <PersonName name={name} lang={locale} />,
                    })}
                    confirm={t('handoverOfferConfirm')}
                    keep={t('keepOffer')}
                    act={() =>
                      offerListingHandover({
                        path: { id: owners.listingId },
                        body: { ownerId: owner.id },
                      })
                    }
                    onDone={(answer) => {
                      if (answer) {
                        onChanged(
                          answer,
                          t.rich('handoverOffered', {
                            name,
                            person: () => <PersonName name={name} lang={locale} />,
                          }),
                          'handover-withdraw',
                        );
                      }
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Two presses for each, in place: removing an owner can't be undone. */
function RemoveOwners({
  owners,
  onRemoved,
}: {
  owners: ListingOwners;
  onRemoved: (owners: ListingOwners, name: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const locale = useLocale();
  const coOwners = owners.owners.filter((owner) => owner.role === 'co_owner');
  if (coOwners.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {coOwners.map((owner) => {
        const name = nameOf(owner);
        const person = () => <PersonName name={name} lang={locale} />;
        return (
          <li key={owner.id}>
            <TwoPresses
              id={`remove-${owner.id}`}
              label={t.rich('remove', { name, person })}
              question={t.rich('removeQuestion', { name, person })}
              confirm={t('removeConfirm')}
              act={() => removeListingOwner({ path: { id: owners.listingId, ownerId: owner.id } })}
              onDone={(answer) => {
                if (answer) onRemoved(answer, name);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function LeaveListing({ listingId, onLeft }: { listingId: string; onLeft: () => void }) {
  const t = useTranslations('Owner.owners');
  return (
    <TwoPresses
      id="leave-listing"
      label={t('leave')}
      question={t('leaveQuestion')}
      confirm={t('leaveConfirm')}
      act={() => leaveListing({ path: { id: listingId } })}
      onDone={onLeft}
    />
  );
}

/**
 * A destructive press asked twice, as deleting a draft is: the question takes the focus, which is
 * what makes it read out, and describes the confirming button; keeping puts the focus back on the
 * first button. Done, the caller says where the focus goes.
 */
function TwoPresses<T>({
  id,
  label,
  question,
  confirm,
  keep,
  act,
  onDone,
}: {
  id: string;
  label: ReactNode;
  question: ReactNode;
  confirm: string;
  /** What declining the question says; "No, keep" fits removals. */
  keep?: string;
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
  const questionId = `${id}-question`;

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
        className={`${WRAPPING_BUTTON} wrap-anywhere`}
        onClick={() => setAsking(true)}
      >
        <span>{label}</span>
      </Button>
    );
  }
  return (
    <div className="grid gap-2">
      <FormError message={failure} />
      <p
        ref={asked}
        id={questionId}
        tabIndex={-1}
        className={`text-sm wrap-anywhere ${FOCUS_TARGET}`}
      >
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className={WRAPPING_BUTTON}
          aria-describedby={questionId}
          aria-disabled={saving || undefined}
          onClick={() => void go()}
        >
          {confirm}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={WRAPPING_BUTTON}
          onClick={() => {
            setAsking(false);
            setFailure(null);
            focusAfter(id);
          }}
        >
          {keep ?? t('keep')}
        </Button>
      </div>
    </div>
  );
}

/** Any owner invites by email (#56); the email goes in the page's language. */
function InviteOwner({
  owners,
  onInvited,
}: {
  owners: ListingOwners;
  onInvited: (owners: ListingOwners, email: string) => void;
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
        body: {
          email,
          locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
        },
      }),
    );
    if (outcome.ok && outcome.data) {
      reset({ email: '' });
      onInvited(outcome.data, email);
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
          <h2 id={INVITE_HEADING} tabIndex={-1} className={FOCUS_TARGET}>
            {t('inviteTitle')}
          </h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('inviteLead', { days: LISTING_INVITE_DAYS })}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">{t('room', { count: owners.room, max: LISTING_OWNERS_MAX })}</p>
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
  onWithdrawn,
}: {
  owners: ListingOwners;
  /**
   * `next`: where the focus goes: the following invitation's button (the one before, if it was
   * the last), else the invitations' heading, else the invite form's, once none are left.
   */
  onWithdrawn: (owners: ListingOwners, email: string, next: string) => void;
}) {
  const t = useTranslations('Owner.owners');
  const format = useFormatter();
  const locale = useLocale();
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
      const answer = outcome.data;
      const mine = (list: ListingOwners['invites']) =>
        list.filter((invite) => invite.canWithdraw && invite.email).map((invite) => invite.id);
      const before = mine(owners.invites);
      const after = new Set(mine(answer.invites));
      const at = before.indexOf(inviteId);
      const next =
        before.slice(at + 1).find((id) => after.has(id)) ??
        before
          .slice(0, Math.max(at, 0))
          .reverse()
          .find((id) => after.has(id));
      onWithdrawn(
        answer,
        email,
        next ? `withdraw-${next}` : answer.invites.length > 0 ? INVITES_HEADING : INVITE_HEADING,
      );
    } else setFailure(ownerError(outcome.ok ? {} : outcome.failure));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={INVITES_HEADING} tabIndex={-1} className={FOCUS_TARGET}>
            {t('invitesTitle')}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={failure} />
        <ul className="grid gap-4">
          {owners.invites.map((invite) => (
            <li key={invite.id} className="grid gap-1">
              <p className="font-medium wrap-anywhere">{invite.email ?? t('inviteHidden')}</p>
              <p className="text-sm text-muted-foreground">
                {invite.expiresAt
                  ? t.rich('inviteUntil', {
                      date: format.dateTime(new Date(invite.expiresAt), {
                        day: 'numeric',
                        month: 'long',
                        ...timeOptions(locale),
                      }),
                      time: (chunks) => <time dateTime={invite.expiresAt ?? ''}>{chunks}</time>,
                    })
                  : t('inviteSending')}
              </p>
              {invite.invitedBy ? (
                <p className="text-sm wrap-anywhere text-muted-foreground">
                  {t.rich('invitedBy', {
                    name: invite.invitedBy,
                    person: () => <PersonName name={invite.invitedBy ?? ''} lang={locale} />,
                  })}
                </p>
              ) : null}
              {invite.canWithdraw && invite.email ? (
                <div>
                  <Button
                    id={`withdraw-${invite.id}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`${WRAPPING_BUTTON} wrap-anywhere`}
                    aria-disabled={busy === invite.id || undefined}
                    onClick={() => void withdraw(invite.id, invite.email ?? '')}
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
