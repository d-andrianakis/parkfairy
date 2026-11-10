'use client';

import { Button } from '@parkfairy/ui/components/button';
import { Map as MapIcon, Maximize } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { ResultPin } from './results-map';

const loadMap = () => import('./results-map');
/** The map's own code and, alongside it, the 480 KiB library it loads once mounted. */
const preload = () => {
  void loadMap();
  void import('mapbox-gl/dist/mapbox-gl-csp.js');
};
// Never on the server: it only renders after a press.
const ResultsMap = lazy(loadMap);

export interface ResultsMapToggleProps {
  token: string;
  pins: ResultPin[];
  center: { latitude: number; longitude: number } | null;
  /** Button texts, from the server's `Search` catalog. */
  show: string;
  hide: string;
  /** The results list: its cards show their pins' numbers while the map does. */
  children: ReactNode;
}

type MapState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * "Show the map" above the results (decision #41). Nothing of Mapbox loads before the press, so a
 * search costs no map load and keeps its JS budget; hovering or focusing the button fetches the
 * code early. Shown once, the map stays mounted and is only hidden: showing it again would be
 * another billed map load. The list stays as it is, the main way through: the map repeats it.
 */
export function ResultsMapToggle({
  token,
  pins,
  center,
  show,
  hide,
  children,
}: ResultsMapToggleProps) {
  const t = useTranslations('ResultsMap');
  const locale = useLocale();
  const mapId = useId();
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<MapState>('idle');
  /** Counts the presses of "Show all results"; the map refits on each. */
  const [fitRequest, setFitRequest] = useState(0);
  // Stable, or the map would start again on every render.
  const labels = useMemo(
    () => ({
      canvas: t('canvas'),
      zoomIn: t('zoomIn'),
      zoomOut: t('zoomOut'),
      attribution: t('attribution'),
      logo: t('logo'),
      searched: t('searched'),
      zoomHintCtrl: t('zoomHintCtrl'),
      zoomHintCmd: t('zoomHintCmd'),
      panHint: t('panHint'),
    }),
    [t],
  );

  // The status line is in the page before it speaks: a region that arrives with its words is
  // often not read.
  useEffect(() => {
    if (!mounted || state !== 'idle') return;
    const frame = requestAnimationFrame(() => setState('loading'));
    return () => cancelAnimationFrame(frame);
  }, [mounted, state]);

  const message = state === 'failed' ? t('failed') : state === 'loading' ? t('loading') : '';

  return (
    <div className="group/results flex flex-col gap-4" data-map={shown ? 'shown' : undefined}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-expanded={shown}
          aria-controls={mounted ? mapId : undefined}
          onPointerEnter={preload}
          onFocus={preload}
          onClick={() => {
            setShown((was) => !was);
            setMounted(true);
          }}
        >
          <MapIcon aria-hidden />
          {shown ? hide : show}
        </Button>
        {/* A way back to every pin without dragging (WCAG 2.5.7's spirit; the list stays the
            equivalent): after zooming or panning, one press. */}
        {shown && state !== 'failed' ? (
          <Button
            type="button"
            variant="outline"
            aria-controls={mapId}
            onClick={() => setFitRequest((times) => times + 1)}
          >
            <Maximize aria-hidden />
            {t('showAll')}
          </Button>
        ) : null}
      </div>
      {mounted ? (
        <section
          id={mapId}
          aria-label={t('map')}
          hidden={!shown}
          className="relative h-80 w-full rounded-lg border bg-muted sm:h-96"
        >
          {/* Under the map until it draws, and in its place if it can't. */}
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {message}
          </p>
          {state === 'failed' ? null : (
            <Suspense fallback={null}>
              <ResultsMap
                token={token}
                locale={locale}
                labels={labels}
                pins={pins}
                center={center}
                onReady={() => setState('ready')}
                onFail={() => setState('failed')}
                fitRequest={fitRequest}
              />
            </Suspense>
          )}
        </section>
      ) : null}
      {children}
    </div>
  );
}
