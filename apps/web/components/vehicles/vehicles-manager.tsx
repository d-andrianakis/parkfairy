'use client';

import {
  changeMyVehicle,
  forgetMyVehicle,
  type SavedVehicle,
  saveMyVehicle,
} from '@parkfairy/api-client';
import { isVehiclePlate, VEHICLE_PLATE_LIMITS } from '@parkfairy/contracts/plates';
import {
  SIZE_MESSAGES,
  SPACE_DIMENSIONS,
  SPACE_LIMITS_CM,
  type SpaceDimension,
  VEHICLE_LIMITS,
} from '@parkfairy/contracts/validation';
import { Button } from '@parkfairy/ui/components/button';
import { FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { attempt } from '@/lib/api-call';
import { useValidationMessage } from '@/lib/use-validation-message';
import { vehicleLabel } from '@/lib/vehicle-label';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

const VEHICLES_MAX = VEHICLE_LIMITS.perDriver;
const VEHICLE_NAME_MAX = VEHICLE_LIMITS.name;

const ERROR_CODES = ['VEHICLE_EXISTS', 'VEHICLE_LIMIT_REACHED', 'VEHICLE_NOT_FOUND'] as const;

const SIZE_FIELDS = [
  { dimension: 'height', key: 'heightCm', label: 'height' },
  { dimension: 'length', key: 'lengthCm', label: 'length' },
  { dimension: 'width', key: 'widthCm', label: 'width' },
] as const satisfies readonly {
  dimension: SpaceDimension;
  key: keyof SavedVehicle;
  label: string;
}[];

type Sizes = Record<SpaceDimension, string>;
type FieldErrors = Partial<Record<'plate' | 'name' | SpaceDimension, string>>;

/** A size as typed: empty is "not said", else whole centimetres within what a space can take. */
function sizeOf(raw: string, dimension: SpaceDimension): number | null | 'invalid' {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d{1,5}$/.test(text)) return 'invalid';
  const value = Number(text);
  const { min, max } = SPACE_LIMITS_CM[dimension];
  return value < min || value > max ? 'invalid' : value;
}

/**
 * Saves, changes and forgets a driver's cars (5A.2). Only the driver sees them. The plate is checked
 * as the booking page checks it, the sizes as an owner's limits are, each error beside its field and
 * the count said in a status. What changes is said in a status too, and the focus goes where the
 * thing pressed has gone: the plate field after an add, the row's button after a change, the
 * list's heading after a removal.
 */
export function VehiclesManager({ initial }: { initial: SavedVehicle[] }) {
  const t = useTranslations('Vehicles');
  const [vehicles, setVehicles] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  /** Remounts the add form once saved, which empties it. */
  const [round, setRound] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const edits = useRef(new Map<string, HTMLButtonElement>());
  /** A request to put the focus back on a vehicle's Edit button: an object each time, so each is one. */
  const [returnTo, setReturnTo] = useState<{ id: string } | null>(null);
  const full = vehicles.length >= VEHICLES_MAX;

  useEffect(() => {
    if (asking) question.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (returnTo) edits.current.get(returnTo.id)?.focus();
  }, [returnTo]);

  /** Said again even when it repeats the last one: the region is emptied first. */
  function announce(text: string) {
    setNotice('');
    requestAnimationFrame(() => setNotice(text));
  }

  const refusal = (code: string | undefined) =>
    ERROR_CODES.find((known) => known === code)
      ? t(`errors.${code as (typeof ERROR_CODES)[number]}`)
      : t('errors.generic');

  async function forget(id: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() => forgetMyVehicle({ path: { id } }));
    setBusy(false);
    if (!outcome.ok) {
      setFailure(refusal(outcome.failure.code));
      return;
    }
    setVehicles(outcome.data.vehicles);
    setAsking(null);
    announce(t('removed'));
    // The row the focus was in has gone.
    headingRef.current?.focus();
  }

  const label = (vehicle: SavedVehicle) => vehicleLabel(vehicle);

  return (
    <div className="grid gap-8">
      {/* What was just done, said once and kept out of the way: not an alert, nothing to act on. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
      <section aria-labelledby="vehicles-list-heading" className="grid gap-3">
        <h2
          id="vehicles-list-heading"
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-xl font-semibold outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t('listLabel')}
        </h2>
        <FormError message={failure} />
        {vehicles.length === 0 ? (
          <p>{t('empty')}</p>
        ) : (
          <ul aria-labelledby="vehicles-list-heading" className="grid gap-3">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded-lg border p-4">
                {editing === vehicle.id ? (
                  <VehicleForm
                    vehicle={vehicle}
                    onCancel={() => {
                      setEditing(null);
                      setReturnTo({ id: vehicle.id });
                    }}
                    onSaved={(list) => {
                      setVehicles(list);
                      setEditing(null);
                      setReturnTo({ id: vehicle.id });
                      announce(t('changed'));
                    }}
                  />
                ) : (
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <p className="font-mono text-lg font-medium">{vehicle.plate}</p>
                      {vehicle.name ? (
                        // The driver's own words: isolated, so a name in another script keeps its order.
                        <p>
                          <bdi>{vehicle.name}</bdi>
                        </p>
                      ) : null}
                      <Sizes vehicle={vehicle} />
                    </div>
                    {asking === vehicle.id ? (
                      <div className="grid gap-3">
                        <p
                          ref={question}
                          tabIndex={-1}
                          className="rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {t('deleteQuestion', { vehicle: label(vehicle) })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="destructive"
                            className={WRAPPING_BUTTON}
                            aria-disabled={busy || undefined}
                            onClick={() => void forget(vehicle.id)}
                          >
                            {busy ? t('deleting') : t('deleteConfirm')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className={WRAPPING_BUTTON}
                            aria-disabled={busy || undefined}
                            onClick={() => {
                              if (busy) return;
                              setAsking(null);
                              setReturnTo({ id: vehicle.id });
                            }}
                          >
                            {t('deleteKeep')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          ref={(node) => {
                            if (node) edits.current.set(vehicle.id, node);
                            else edits.current.delete(vehicle.id);
                          }}
                          type="button"
                          variant="outline"
                          size="sm"
                          className={WRAPPING_BUTTON}
                          aria-label={t('editLabel', { vehicle: label(vehicle) })}
                          onClick={() => {
                            setFailure(null);
                            setEditing(vehicle.id);
                          }}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={WRAPPING_BUTTON}
                          aria-label={t('deleteLabel', { vehicle: label(vehicle) })}
                          onClick={() => {
                            setFailure(null);
                            setAsking(vehicle.id);
                          }}
                        >
                          {t('delete')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="vehicles-add-heading" className="grid gap-3">
        <h2 id="vehicles-add-heading" className="text-xl font-semibold">
          {t('addHeading')}
        </h2>
        {full ? (
          <p>{t('full', { max: VEHICLES_MAX })}</p>
        ) : (
          <VehicleForm
            key={round}
            focusPlate={round > 0}
            onSaved={(list) => {
              setVehicles(list);
              setRound((count) => count + 1);
              announce(t('added'));
              // The last one that fits takes the form away: the focus goes to the list, not the void.
              if (list.length >= VEHICLES_MAX) headingRef.current?.focus();
            }}
          />
        )}
      </section>
    </div>
  );
}

/** A vehicle's size, in the words of its listing: "190 cm high · 440 cm long". */
function Sizes({ vehicle }: { vehicle: SavedVehicle }) {
  const t = useTranslations('Vehicles');
  const format = useFormatter();
  const parts = [
    vehicle.heightCm === null ? null : t('sizeHigh', { value: format.number(vehicle.heightCm) }),
    vehicle.lengthCm === null ? null : t('sizeLong', { value: format.number(vehicle.lengthCm) }),
    vehicle.widthCm === null ? null : t('sizeWide', { value: format.number(vehicle.widthCm) }),
  ].filter((part) => part !== null);
  return (
    <p className="text-sm text-muted-foreground">
      {parts.length > 0 ? parts.join(' · ') : t('noSizes')}
    </p>
  );
}

/** One vehicle's fields: new when `vehicle` is left out, a change to it otherwise. */
function VehicleForm({
  vehicle,
  onSaved,
  onCancel,
  focusPlate = false,
}: {
  vehicle?: SavedVehicle;
  onSaved: (vehicles: SavedVehicle[]) => void;
  onCancel?: () => void;
  focusPlate?: boolean;
}) {
  const t = useTranslations('Vehicles');
  const validation = useValidationMessage();
  const invalid = useInvalidSubmitStatus();
  const prefix = vehicle ? `vehicle-${vehicle.id}` : 'vehicle-new';
  const plateRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const sizeRefs = useRef<Partial<Record<SpaceDimension, HTMLInputElement | null>>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const headingId = `${prefix}-heading`;

  useEffect(() => {
    // Editing opens on the plate; an add that just saved goes back to it for the next one.
    if (vehicle || focusPlate) plateRef.current?.focus();
  }, [vehicle, focusPlate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const plate = (plateRef.current?.value ?? '').trim();
    const name = (nameRef.current?.value ?? '').trim();
    const found: FieldErrors = {};
    if (plate === '') found.plate = validation('plateRequired');
    else if (!isVehiclePlate(plate)) found.plate = validation('plateInvalid');
    if ([...name].length > VEHICLE_NAME_MAX) found.name = validation('textTooLong');
    const sizes: Partial<Record<SpaceDimension, number | null>> = {};
    for (const { dimension } of SIZE_FIELDS) {
      const size = sizeOf(sizeRefs.current[dimension]?.value ?? '', dimension);
      if (size === 'invalid') found[dimension] = validation(SIZE_MESSAGES[dimension]);
      else sizes[dimension] = size;
    }
    setErrors(found);
    setFailure(null);
    const order = ['plate', 'name', ...SPACE_DIMENSIONS] as const;
    const first = order.find((field) => found[field]);
    if (first) {
      invalid.report(order.filter((field) => found[field]).length);
      (first === 'plate'
        ? plateRef.current
        : first === 'name'
          ? nameRef.current
          : sizeRefs.current[first]
      )?.focus();
      return;
    }
    invalid.clear();
    setSaving(true);
    const body = {
      plate,
      name: name === '' ? null : name,
      heightCm: sizes.height ?? null,
      lengthCm: sizes.length ?? null,
      widthCm: sizes.width ?? null,
    };
    const outcome = await attempt(() =>
      vehicle ? changeMyVehicle({ path: { id: vehicle.id }, body }) : saveMyVehicle({ body }),
    );
    setSaving(false);
    if (outcome.ok) {
      onSaved(outcome.data.vehicles);
      return;
    }
    const { code } = outcome.failure;
    if (code === 'VEHICLE_EXISTS') {
      // About the plate, so said at the plate.
      setErrors({ plate: t('errors.VEHICLE_EXISTS') });
      plateRef.current?.focus();
      return;
    }
    setFailure(
      code === 'VEHICLE_LIMIT_REACHED' || code === 'VEHICLE_NOT_FOUND'
        ? t(`errors.${code}`)
        : t('errors.generic'),
    );
  }

  return (
    <form
      noValidate
      aria-labelledby={vehicle ? headingId : undefined}
      onSubmit={(event) => void submit(event)}
      className="grid gap-4"
    >
      {vehicle ? (
        <h3 id={headingId} className="font-medium">
          {t('editHeading', { vehicle: vehicleLabel(vehicle) })}
        </h3>
      ) : null}
      {invalid.region}
      <FormField
        ref={plateRef}
        id={`${prefix}-plate`}
        label={t('plate')}
        hint={t('plateHint')}
        error={errors.plate}
        defaultValue={vehicle?.plate ?? ''}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={VEHICLE_PLATE_LIMITS.input}
        className="max-w-xs font-mono"
      />
      <FormField
        ref={nameRef}
        id={`${prefix}-name`}
        label={t('name')}
        hint={t('nameHint')}
        error={errors.name}
        defaultValue={vehicle?.name ?? ''}
        autoComplete="off"
        // A longer name is refused with a message, not cut off as it is typed.
        maxLength={VEHICLE_NAME_MAX * 2}
        className="max-w-xs"
      />
      <FieldSet aria-describedby={`${prefix}-size-hint`}>
        <FieldLegend variant="label">{t('sizeLegend')}</FieldLegend>
        <p id={`${prefix}-size-hint`} className="text-sm text-muted-foreground">
          {t('sizeHint')}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {SIZE_FIELDS.map(({ dimension, key, label }) => (
            <FormField
              key={dimension}
              ref={(node) => {
                sizeRefs.current[dimension] = node;
              }}
              id={`${prefix}-${dimension}`}
              label={t(label)}
              error={errors[dimension]}
              defaultValue={vehicle?.[key] ?? ''}
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
            />
          ))}
        </div>
      </FieldSet>
      <FormError message={failure} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={WRAPPING_BUTTON} aria-disabled={saving || undefined}>
          {saving ? t('saving') : vehicle ? t('saveChanges') : t('save')}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onCancel();
            }}
          >
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
