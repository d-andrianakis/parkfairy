import { greekRuns } from '@parkfairy/contracts/greek-runs';

/**
 * Words people typed or are called, on a page in `lang`, their Greek script marked as Greek
 * (WCAG 3.1.2): an English voice would spell «Ελένη Παπά» out letter by letter. A server or client
 * component alike.
 */
export function MarkedText({ text, lang }: { text: string; lang: string }) {
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
 * Someone's name, in a language nobody told us: isolated, so a right-to-left script can't reorder
 * the text around it, and its Greek letters marked on a page in another language.
 */
export function PersonName({ name, lang }: { name: string; lang: string }) {
  return (
    <bdi>
      <MarkedText text={name} lang={lang} />
    </bdi>
  );
}
