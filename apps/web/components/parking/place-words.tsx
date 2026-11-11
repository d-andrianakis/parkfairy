import { greekRuns } from '@parkfairy/contracts/greek-runs';

/**
 * A place's words on a page in `lang`, its Greek-script parts marked as Greek: what Mapbox
 * returns, or what someone typed (a listing's name, its address, a space's label, its
 * description). A server or client component alike.
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

/**
 * A place's words inside text of ours, in the language they were written in, their Greek parts
 * marked. Without `lang` the words are our own (an unnamed listing's), in the page's language.
 */
export function PlaceName({ text, lang }: { text: string; lang?: string | undefined }) {
  return lang ? (
    <span lang={lang}>
      <PlaceWords text={text} lang={lang} />
    </span>
  ) : (
    text
  );
}

/**
 * For `t.rich`: the tag around a place's words inside one of our sentences ("Bookings for
 * “<listing>{name}</listing>”"), as `PlaceName` sets them.
 */
export function placeTag(text: string, lang: string | undefined) {
  return function PlaceTag() {
    return <PlaceName text={text} lang={lang} />;
  };
}

/**
 * Someone's own name, in a language nobody told us: isolated, so a right-to-left script can't
 * reorder the text around it, and Greek letters (which can only be Greek) marked on a page in
 * another language.
 */
export function PersonName({
  name,
  lang,
  className,
}: {
  name: string;
  /** The page's language. */
  lang: string;
  className?: string;
}) {
  return (
    <bdi className={className}>
      <PlaceWords text={name} lang={lang} />
    </bdi>
  );
}
