import { greekRuns } from '@/lib/greek-runs';

/**
 * A place's words on a page in `lang`, its Greek-script parts marked as Greek: what Mapbox
 * returns, or what someone typed. A server or client component alike.
 */
export function PlaceWords({ text, lang }: { text: string; lang: string }) {
  return (
    <>
      {greekRuns(text, lang).map((run, index) =>
        run.lang ? (
          <span key={index} lang={run.lang}>
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}
