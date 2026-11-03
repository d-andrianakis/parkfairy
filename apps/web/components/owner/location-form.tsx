'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingLocation, type ListingLocationPatch } from '@parkfairy/api-client';
import {
  AREAS,
  AREA_IDS,
  ListingLocationInputSchema,
  ListingLocationPatchSchema,
  SUPPORTED_LOCALES,
  type AreaId,
  type Locale,
  type OwnerListing,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup, FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { LocateFixed, Map as MapIcon, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { LOCALE_ENDONYMS } from '@/i18n/locales';
import { findAddress, type AddressMatch } from '@/lib/mapbox-geocode';
import { listingStepHref } from '@/lib/owner';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { SelectField, SelectOption, TextareaField, useOptionalLabel } from './fields';
import type { LocationMapProps } from './location-map';
import { useFocusAfterRender, useStepNavigation } from './navigation';
import { SaveStatus, useAutosave } from './save-status';
import { StepActions } from './step-actions';

/** About 11 cm: more than a pin on a phone can mean. */
const COORDINATE_DECIMALS = 6;

const FIELD_ORDER = ['name', 'address', 'latitude', 'longitude', 'areaId', 'description'] as const;
type Field = (typeof FIELD_ORDER)[number];
type Errors = Partial<Record<Field, string>>;

/** The curated area nearest a point; search only needs one for the label on the card. */
function nearestArea(latitude: number, longitude: number): AreaId | undefined {
  const scale = Math.cos((latitude * Math.PI) / 180);
  const distance = (area: (typeof AREAS)[number]) =>
    (area.latitude - latitude) ** 2 + ((area.longitude - longitude) * scale) ** 2;
  return [...AREAS].sort((a, b) => distance(a) - distance(b))[0]?.id;
}

const toNumber = (text: string) => (text.trim() === '' ? null : Number(text.replace(',', '.')));

export function LocationForm({
  listing,
  mapboxToken,
}: {
  listing: OwnerListing;
  mapboxToken: string | null;
}) {
  const t = useTranslations('Owner.location');
  const tAreas = useTranslations('Areas');
  const locale = useLocale();
  const go = useStepNavigation();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const invalid = useInvalidSubmitStatus();
  const focusAfter = useFocusAfterRender();
  // Visible: a refused location or failed search is news for everyone, not just screen readers.
  const notice = useAnnouncer('text-sm text-muted-foreground empty:hidden');
  const { location } = listing;

  const [name, setName] = useState(location.name ?? '');
  const [address, setAddress] = useState(location.address ?? '');
  const [areaId, setAreaId] = useState<AreaId | ''>(location.areaId ?? '');
  const [latitude, setLatitude] = useState(location.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(location.longitude?.toString() ?? '');
  const [description, setDescription] = useState(location.description ?? '');
  const [contentLocale, setContentLocale] = useState<Locale>(location.contentLocale);
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [LocationMap, setLocationMap] = useState<ComponentType<LocationMapProps> | null>(null);
  const [mapState, setMapState] = useState<'closed' | 'loading' | 'failed'>('closed');

  const mapLabels = useMemo(
    () => ({
      map: t('mapLabel'),
      pin: t('mapPin'),
      zoomIn: t('mapZoomIn'),
      zoomOut: t('mapZoomOut'),
      attribution: t('mapAttribution'),
      logo: t('mapLogo'),
    }),
    [t],
  );

  const { state, autosave, remember, settled } = useAutosave(async (key, value) => {
    const body = (typeof value === 'string' ? { [key]: value } : value) as ListingLocationPatch;
    const outcome = await attempt(() => saveListingLocation({ path: { id: listing.id }, body }));
    if (outcome.ok && key === 'pin') notice.announce(t('pinPlaced'));
    return outcome.ok;
  });

  useEffect(() => {
    remember('name', location.name ?? '');
    remember('address', location.address ?? '');
    remember('description', location.description ?? '');
  }, [location, remember]);

  function mapFailed() {
    setLocationMap(null);
    setMapState('failed');
  }

  /** On intent: the map is heavy, and each one shown is a billed map load. */
  function showMap() {
    if (mapState === 'loading') return;
    setMapState('loading');
    import('./location-map').then(({ default: map }) => setLocationMap(() => map)).catch(mapFailed);
  }

  function saveText(field: 'name' | 'address' | 'description', value: string) {
    if (ListingLocationPatchSchema.safeParse({ [field]: value }).success) autosave(field, value);
  }

  function placePin(lat: number, lng: number) {
    const rounded = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS));
    const pin = { latitude: rounded(lat), longitude: rounded(lng) };
    setLatitude(String(pin.latitude));
    setLongitude(String(pin.longitude));
    const area = areaId || nearestArea(pin.latitude, pin.longitude);
    const patch = { ...pin, ...(area ? { areaId: area } : {}) };
    if (ListingLocationPatchSchema.safeParse(patch).success) {
      setErrors((current) => ({ ...current, latitude: undefined, longitude: undefined }));
      if (area) setAreaId(area);
      autosave('pin', patch);
    } else {
      const refused = message('outsideGreece');
      setErrors((current) => ({ ...current, latitude: refused }));
      if (refused) notice.announce(refused);
    }
  }

  function typedPin() {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      placePin(lat, lng);
    }
  }

  function locateMe() {
    if (locating) return;
    if (!('geolocation' in navigator)) {
      notice.announce(t('locationUnavailable'));
      return;
    }
    setLocating(true);
    notice.announce(t('locating'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        placePin(coords.latitude, coords.longitude);
      },
      (error) => {
        setLocating(false);
        notice.announce(
          error.code === error.PERMISSION_DENIED ? t('locationDenied') : t('locationUnavailable'),
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function search() {
    if (!mapboxToken || searching) return;
    if (address.trim() === '') {
      setErrors((current) => ({ ...current, address: message('addressRequired') }));
      focusAfter('location-address');
      return;
    }
    setSearching(true);
    const found = await findAddress(address, mapboxToken, locale);
    setSearching(false);
    setMatches(found);
    notice.announce(found ? t('searchResults', { count: found.length }) : t('searchFailed'));
  }

  function chooseMatch(match: AddressMatch) {
    setAddress(match.address);
    setMatches(null);
    saveText('address', match.address);
    placePin(match.latitude, match.longitude);
    focusAfter('location-address'); // the button that had the focus has gone with the list
  }

  async function save(destination: 'next' | 'later') {
    if (saving) return;
    setFailure(null);
    const input = {
      name,
      address,
      areaId: areaId || undefined,
      latitude: toNumber(latitude) ?? undefined,
      longitude: toNumber(longitude) ?? undefined,
      description: description.trim() || null,
      contentLocale,
    };
    const parsed = ListingLocationInputSchema.safeParse(input);
    if (!parsed.success && destination === 'next') {
      const found: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field;
        found[key] ??= message(issue.message);
      }
      setErrors(found);
      invalid.report(Object.keys(found).length);
      const first = FIELD_ORDER.find((key) => found[key]);
      if (first) focusAfter(`location-${first}`);
      return;
    }
    invalid.clear();
    setErrors({});
    setSaving(true);
    await settled();
    if (!parsed.success) {
      go('/owner'); // what was valid is already saved
      return;
    }
    const outcome = await attempt(() =>
      saveListingLocation({
        path: { id: listing.id },
        body: parsed.data as unknown as ListingLocationPatch,
      }),
    );
    if (!outcome.ok) {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
      return;
    }
    const next = outcome.data?.nextStep;
    go(destination === 'next' && next ? listingStepHref(listing.id, next) : '/owner');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save('next');
  }

  const lat = toNumber(latitude);
  const lng = toNumber(longitude);
  const pinIsNumber = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {invalid.region}
        <FormField
          id="location-name"
          label={t('name')}
          hint={t('nameHint')}
          lang={contentLocale}
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => saveText('name', name)}
        />
        <div className="grid gap-2">
          <FormField
            id="location-address"
            label={t('address')}
            lang={contentLocale}
            autoComplete="street-address"
            value={address}
            error={errors.address}
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => saveText('address', address)}
          />
          {mapboxToken ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={WRAPPING_BUTTON}
                aria-disabled={searching || undefined}
                onClick={() => void search()}
              >
                <Search aria-hidden />
                {searching ? t('searching') : t('search')}
              </Button>
            </div>
          ) : null}
          {matches && matches.length > 0 ? (
            <ul aria-label={t('matches')} className="grid gap-1">
              {matches.map((match) => (
                <li key={match.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={`${WRAPPING_BUTTON} w-full justify-start text-left`}
                    onClick={() => chooseMatch(match)}
                  >
                    {match.address}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {matches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
          ) : null}
        </div>

        <FieldSet className="rounded-lg border p-4">
          <FieldLegend>{t('pinHeading')}</FieldLegend>
          <p className="text-sm text-muted-foreground">
            {mapboxToken ? t('pinLeadMap') : t('pinLead')}
          </p>
          {/* The same box before and after, so nothing below it moves when the map arrives. */}
          {mapboxToken ? (
            <div className="flex h-72 w-full items-center justify-center rounded-lg border bg-muted">
              {LocationMap ? (
                <LocationMap
                  token={mapboxToken}
                  locale={locale}
                  labels={mapLabels}
                  latitude={pinIsNumber ? lat : null}
                  longitude={pinIsNumber ? lng : null}
                  onPick={placePin}
                  onFail={mapFailed}
                />
              ) : mapState === 'failed' ? (
                <p className="max-w-sm p-4 text-center text-sm">{t('mapFailed')}</p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className={WRAPPING_BUTTON}
                  aria-disabled={mapState === 'loading' || undefined}
                  onClick={showMap}
                >
                  <MapIcon aria-hidden />
                  {mapState === 'loading' ? t('mapLoading') : t('showMap')}
                </Button>
              )}
            </div>
          ) : null}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={WRAPPING_BUTTON}
              aria-disabled={locating || undefined}
              onClick={locateMe}
            >
              <LocateFixed aria-hidden />
              {locating ? t('locating') : t('useMyLocation')}
            </Button>
          </div>
          {notice.region}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="location-latitude"
              label={t('latitude')}
              hint={t('coordinatesHint')}
              inputMode="decimal"
              value={latitude}
              error={errors.latitude}
              onChange={(event) => setLatitude(event.target.value)}
              onBlur={typedPin}
            />
            <FormField
              id="location-longitude"
              label={t('longitude')}
              inputMode="decimal"
              value={longitude}
              error={errors.longitude}
              onChange={(event) => setLongitude(event.target.value)}
              onBlur={typedPin}
            />
          </div>
        </FieldSet>

        <SelectField
          id="location-areaId"
          label={t('area')}
          hint={t('areaHint')}
          value={areaId}
          error={errors.areaId}
          onChange={(event) => {
            const area = event.target.value as AreaId;
            setAreaId(area);
            autosave('areaId', { areaId: area });
          }}
        >
          <SelectOption value="" disabled>
            {t('areaPlaceholder')}
          </SelectOption>
          {AREA_IDS.map((id) => (
            <SelectOption key={id} value={id}>
              {tAreas(id)}
            </SelectOption>
          ))}
        </SelectField>

        <TextareaField
          id="location-description"
          label={optional(t('description'))}
          hint={t('descriptionHint')}
          lang={contentLocale}
          rows={4}
          value={description}
          error={errors.description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => saveText('description', description)}
        />

        <SelectField
          id="location-contentLocale"
          label={t('language')}
          hint={t('languageHint')}
          value={contentLocale}
          onChange={(event) => {
            const value = event.target.value as Locale;
            setContentLocale(value);
            autosave('contentLocale', { contentLocale: value });
          }}
        >
          {SUPPORTED_LOCALES.map((value) => (
            <SelectOption key={value} value={value} lang={value}>
              {LOCALE_ENDONYMS[value]}
            </SelectOption>
          ))}
        </SelectField>

        <SaveStatus state={state} />
        <FormError message={failure} />
        <StepActions saving={saving} onLater={() => void save('later')} />
      </FieldGroup>
    </form>
  );
}
