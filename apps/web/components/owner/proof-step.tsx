'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { deleteListingProof, saveListingProofDetails } from '@parkfairy/api-client';
import {
  PROOF_CONTENT_TYPES,
  PROOF_KINDS,
  PROOF_LIMITS,
  ListingProofPatchSchema,
  type OwnerListing,
  type OwnerProof,
  type ProofKind,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { Progress } from '@parkfairy/ui/components/progress';
import { Download, FileText, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type ChangeEvent } from 'react';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { Link } from '@/i18n/navigation';
import { listingStepHref } from '@/lib/owner';
import { attempt, uploadFile, useOwnerError, type Outcome } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { SelectField, SelectOption, useOptionalLabel } from './fields';
import { useFocusAfterRender } from './navigation';
import { SaveStatus, useAutosave } from './save-status';

const MEGABYTE = 1024 * 1024;

export function ProofStep({ listing }: { listing: OwnerListing }) {
  const t = useTranslations('Owner.proof');
  const tStep = useTranslations('Owner.step');
  const format = useFormatter();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const message = useValidationMessage();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const [proofs, setProofs] = useState<OwnerProof[]>(listing.proofs);
  const [kind, setKind] = useState<ProofKind>('titleDeed');
  const [percent, setPercent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [landError, setLandError] = useState<string | undefined>();

  const { state, autosave, remember } = useAutosave(async (_name, value) => {
    const body = ListingProofPatchSchema.safeParse({ landRegistrationNumber: value });
    if (!body.success) return false;
    const outcome = await attempt(() =>
      saveListingProofDetails({ path: { id: listing.id }, body: body.data }),
    );
    return outcome.ok;
  });

  useEffect(() => {
    remember('landRegistrationNumber', listing.landRegistrationNumber ?? '');
  }, [listing.landRegistrationNumber, remember]);

  function saveLandNumber(value: string) {
    const valid = ListingProofPatchSchema.safeParse({ landRegistrationNumber: value }).success;
    setLandError(valid ? undefined : message('landRegistrationInvalid'));
    if (valid) autosave('landRegistrationNumber', value);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProblem(null);
    if (file.size > PROOF_LIMITS.maxBytes) {
      setProblem(t('tooLarge'));
      return;
    }
    setPercent(0);
    announce(t('uploading'));
    // A file's name can say whose it is, so it travels in a header: query strings reach logs.
    const outcome: Outcome<OwnerProof> = await uploadFile(
      `/api/v1/owner/listings/${listing.id}/proofs?kind=${kind}`,
      file,
      setPercent,
      { 'X-File-Name': encodeURIComponent(file.name) },
    );
    setPercent(null);
    if (outcome.ok) {
      const proof = outcome.data;
      setProofs((current) => [...current, proof]);
      announce(t('uploaded'));
    } else setProblem(ownerError(outcome.failure));
  }

  async function remove(proof: OwnerProof) {
    const outcome = await attempt(() =>
      deleteListingProof({ path: { id: listing.id, proofId: proof.id } }),
    );
    if (outcome.ok) {
      setProofs((current) => current.filter((item) => item.id !== proof.id));
      setProblem(null);
      announce(t('removed'));
      focusAfter('proof-chooser'); // the button that had the focus has gone
    } else setProblem(ownerError(outcome.failure));
  }

  const full = proofs.length >= PROOF_LIMITS.maxPerListing;
  /** Under a megabyte in kilobytes: a small scan shouldn't read "0 MB". */
  const fileSize = (bytes: number) =>
    bytes < MEGABYTE
      ? format.number(Math.max(1, Math.round(bytes / 1024)), { style: 'unit', unit: 'kilobyte' })
      : format.number(bytes / MEGABYTE, {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1,
        });

  return (
    <FieldGroup>
      <FormError message={problem} />
      {region}
      <p className="text-sm text-muted-foreground">{t('privacy')}</p>

      <SelectField
        id="proof-kind"
        label={t('kind')}
        value={kind}
        onChange={(event) => setKind(event.target.value as ProofKind)}
      >
        {PROOF_KINDS.map((value) => (
          <SelectOption key={value} value={value}>
            {t(`kinds.${value}`)}
          </SelectOption>
        ))}
      </SelectField>

      <FormField
        id="proof-chooser"
        label={t('choose')}
        hint={t('chooseHint')}
        type="file"
        accept={PROOF_CONTENT_TYPES.join(',')}
        aria-disabled={percent !== null || full || undefined}
        onClick={(event) => {
          // aria-disabled, never disabled: that would drop the focus from a control still in use.
          if (percent !== null || full) event.preventDefault();
        }}
        onChange={(event) => void upload(event)}
      />

      {percent !== null ? (
        <div className="grid gap-1">
          <p className="text-sm" aria-hidden>
            {t('uploadingPercent', { percent })}
          </p>
          <Progress value={percent} aria-label={t('uploading')} />
        </div>
      ) : null}

      {proofs.length > 0 ? (
        <section aria-labelledby="proofs-heading" className="grid gap-2">
          <h2 id="proofs-heading" className="font-medium">
            {t('listHeading')}
          </h2>
          <ul className="grid gap-2">
            {proofs.map((proof) => (
              <li
                key={proof.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 wrap-anywhere">
                    {proof.fileName}
                    <span className="block text-sm text-muted-foreground">
                      {t(`kinds.${proof.kind}`)} · {fileSize(proof.sizeBytes)}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className={WRAPPING_BUTTON}>
                    <a
                      href={`/api/v1/owner/listings/${listing.id}/proofs/${proof.id}`}
                      className="wrap-anywhere"
                    >
                      <Download aria-hidden />
                      {t('download', { name: proof.fileName })}
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`${WRAPPING_BUTTON} wrap-anywhere`}
                    onClick={() => void remove(proof)}
                  >
                    <Trash2 aria-hidden />
                    {t('remove', { name: proof.fileName })}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FormField
        id="land-registration"
        label={optional(t('landRegistration'))}
        hint={t('landRegistrationHint')}
        defaultValue={listing.landRegistrationNumber ?? ''}
        error={landError}
        onBlur={(event) => saveLandNumber(event.target.value)}
      />

      <SaveStatus state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className={WRAPPING_BUTTON}>
          <Link href="/owner">{tStep('saveLater')}</Link>
        </Button>
        {proofs.length > 0 ? (
          <Button asChild className={WRAPPING_BUTTON}>
            <Link href={listingStepHref(listing.id, 'review')}>{tStep('continue')}</Link>
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  );
}
