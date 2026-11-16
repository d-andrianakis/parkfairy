'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import {
  AdminDisputeDecisionInputSchema,
  AdminReasonInputSchema,
  ADMIN_REASON_NOTE_MAX,
} from '@parkfairy/contracts';
import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import {
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@parkfairy/ui/components/field';
import { RadioGroup, RadioGroupItem } from '@parkfairy/ui/components/radio-group';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ChangePanel } from '@/components/change-panel';
import { cancelBooking, decideDispute, retryRefund, settleRefund } from '@/lib/admin-client';

type Money = { amountMinor: number; currency: string };

/** What a money question says: the amount, in the page's language. */
function useMoney() {
  const format = useFormatter();
  return ({ amountMinor, currency }: Money) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
}

const DECISION_NOTE = AdminDisputeDecisionInputSchema.pick({ note: true });

/**
 * What staff may do to one booking (5.2c3): call it off with a full refund (#82), ask Stripe again
 * for a refund that failed or mark it settled (#84), and decide who bears a lost dispute (#83).
 * Each is a note, one more question, and a heading that takes the focus; each keeps its own state.
 */
function CancelPanel({
  id,
  total,
  available,
  onFinished,
}: {
  id: string;
  total: Money;
  available: boolean;
  onFinished: () => void;
}) {
  const t = useTranslations('AdminBooking');
  const money = useMoney();
  return (
    <ChangePanel
      key="cancel"
      available={available}
      onFinished={onFinished}
      id="cancel"
      heading={t('cancel.heading')}
      text={t('cancel.text')}
      schema={AdminReasonInputSchema}
      labels={{
        note: t('cancel.note'),
        hint: t('hint', { max: ADMIN_REASON_NOTE_MAX }),
        submit: t('cancel.submit'),
        question: t('cancel.question', { amount: money(total) }),
        confirm: t('cancel.confirm'),
        busy: t('cancel.busy'),
        cancel: t('notYet'),
      }}
      run={(note) => cancelBooking(id, note)}
      done={{ title: t('cancel.doneTitle'), text: t('cancel.doneText') }}
      stale={['NOT_CANCELLABLE', 'BOOKING_NOT_FOUND']}
    />
  );
}

function RefundPanels({
  id,
  amount,
  canRetry,
  canSettle,
  onFinished,
}: {
  id: string;
  amount: Money;
  canRetry: boolean;
  canSettle: boolean;
  onFinished: () => void;
}) {
  const t = useTranslations('AdminBooking');
  const money = useMoney();
  const labels = (kind: 'retry' | 'settle') => ({
    note: t(`${kind}.note`),
    hint: t('hint', { max: ADMIN_REASON_NOTE_MAX }),
    submit: t(`${kind}.submit`),
    question: t(`${kind}.question`, { amount: money(amount) }),
    confirm: t(`${kind}.confirm`),
    busy: t(`${kind}.busy`),
    cancel: t('notYet'),
  });
  const stale = ['REFUND_NOT_FAILED', 'TRANSFER_MADE', 'BOOKING_NOT_FOUND'];
  return (
    <div className="grid gap-8">
      <ChangePanel
        key="retry"
        available={canRetry}
        onFinished={onFinished}
        id="retry"
        heading={t('retry.heading')}
        text={t('retry.text')}
        schema={AdminReasonInputSchema}
        labels={labels('retry')}
        run={(note) => retryRefund(id, note)}
        done={{ title: t('retry.doneTitle'), text: t('retry.doneText') }}
        stale={stale}
      />
      <ChangePanel
        key="settle"
        available={canSettle}
        onFinished={onFinished}
        id="settle"
        heading={t('settle.heading')}
        text={t('settle.text')}
        schema={AdminReasonInputSchema}
        labels={labels('settle')}
        run={(note) => settleRefund(id, note)}
        done={{ title: t('settle.doneTitle'), text: t('settle.doneText') }}
        stale={stale}
      />
    </div>
  );
}

const DECISIONS = ['parkfairy_bears', 'owners_bear'] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * Who bears a lost dispute (#57, #83): a choice with what each means, and only once it is made, the
 * note and the question. Changing the choice starts the form over, so a note written for one is
 * never sent for the other.
 */
function DisputePanel({
  id,
  amount,
  available,
  payoutHeld,
  onFinished,
}: {
  id: string;
  amount: Money;
  available: boolean;
  /** Whether the owners' payout is still to come: else only Parkfairy's bearing it is recorded. */
  payoutHeld: boolean;
  onFinished: () => void;
}) {
  const t = useTranslations('AdminBooking');
  const money = useMoney();
  const group = useId();
  const [choice, setChoice] = useState<Decision | null>(null);
  return (
    <div className="grid gap-4">
      {available ? (
        <section aria-labelledby={`${group}-heading`} className="grid gap-3">
          <h3 id={`${group}-heading`} className="font-semibold">
            {t('dispute.heading')}
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(payoutHeld ? 'dispute.text' : 'dispute.textPaid', { amount: money(amount) })}
          </p>
          <FieldSet>
            <FieldLegend variant="label">{t('dispute.legend')}</FieldLegend>
            <RadioGroup
              value={choice ?? ''}
              onValueChange={(value) => setChoice(value as Decision)}
              className="grid gap-3"
            >
              {DECISIONS.filter((value) => payoutHeld || value === 'parkfairy_bears').map(
                (value) => (
                  <div key={value} className="flex items-start gap-3">
                    <RadioGroupItem
                      value={value}
                      id={`${group}-${value}`}
                      aria-describedby={`${group}-${value}-hint`}
                    />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor={`${group}-${value}`}>{t(`dispute.${value}`)}</FieldLabel>
                      <FieldDescription id={`${group}-${value}-hint`}>
                        {t(`dispute.${value}Hint`)}
                      </FieldDescription>
                    </div>
                  </div>
                ),
              )}
            </RadioGroup>
          </FieldSet>
        </section>
      ) : null}
      {choice ? (
        <ChangePanel
          key={choice}
          available={available}
          onFinished={onFinished}
          id={`decide-${id}-${choice}`}
          heading={t(`dispute.${choice}Heading`)}
          text={t(`dispute.${choice}Text`)}
          schema={DECISION_NOTE}
          labels={{
            note: t('dispute.note'),
            hint: t('hint', { max: ADMIN_REASON_NOTE_MAX }),
            submit: t('dispute.submit'),
            question: t(`dispute.${choice}Question`),
            confirm: t('dispute.confirm'),
            busy: t('dispute.busy'),
            cancel: t('notYet'),
          }}
          run={(note) => decideDispute(id, choice, note)}
          done={{ title: t('dispute.doneTitle'), text: t(`dispute.${choice}Done`) }}
          stale={['ALREADY_DECIDED', 'NOT_LOST', 'DISPUTE_NOT_FOUND']}
        />
      ) : null}
    </div>
  );
}

/**
 * Everything staff can do to a booking, kept mounted while the page refreshes after a change, so
 * the heading that says it is done stays, and the note that there is nothing to do never appears
 * beside it.
 */
export function BookingActions({
  id,
  total,
  refund,
  canCancel,
  canRetryRefund,
  canSettleRefund,
  disputes,
}: {
  id: string;
  total: Money;
  refund: Money | null;
  canCancel: boolean;
  canRetryRefund: boolean;
  canSettleRefund: boolean;
  disputes: { id: string; amount: Money; canDecide: boolean; payoutHeld: boolean }[];
}) {
  const t = useTranslations('AdminBooking');
  const [touched, setTouched] = useState(false);
  const nothing =
    !canCancel && !canRetryRefund && !canSettleRefund && !disputes.some((d) => d.canDecide);
  const finished = () => setTouched(true);
  return (
    <div className="grid gap-8">
      {nothing && !touched ? (
        <Alert role="note">
          <AlertDescription>{t('nothing')}</AlertDescription>
        </Alert>
      ) : null}
      <CancelPanel id={id} total={total} available={canCancel} onFinished={finished} />
      <RefundPanels
        id={id}
        amount={refund ?? total}
        canRetry={canRetryRefund}
        canSettle={canSettleRefund}
        onFinished={finished}
      />
      {disputes.map((dispute) => (
        <DisputePanel
          key={dispute.id}
          id={dispute.id}
          amount={dispute.amount}
          available={dispute.canDecide}
          payoutHeld={dispute.payoutHeld}
          onFinished={finished}
        />
      ))}
    </div>
  );
}
