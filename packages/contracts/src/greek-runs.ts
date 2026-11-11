/**
 * A run of Greek script: from a Greek letter to the last one, with the spaces, digits and
 * punctuation between them ("Ερμού 15, Αθήνα"), so a name is one run rather than a run per word.
 * Digits glued to it belong to it ("28ης Οκτωβρίου", "Α1"), and so do the numeral sign and the
 * modifier apostrophe ("Γʹ Σεπτεμβρίου"), which are neither Greek nor punctuation to Unicode.
 * A number after a space stays with the text around it.
 */
const GREEK_RUN =
  /\p{N}*\p{Script=Greek}(?:[\p{Script=Greek}\p{M}\p{N}\p{Zs}\p{P}\u02B9\u02BC\u0374]*[\p{Script=Greek}\p{M}])?\p{N}*/gu;

export interface TextRun {
  text: string;
  /** Set only where the run's language differs from the text around it. */
  lang?: 'el';
}

/**
 * Text written for a page in `lang`, split where it turns to Greek script. Mapbox answers in the
 * language asked for where it can and gives a place's Greek name where it has no other (an English
 * page then shows «Ερμού 15, Athens»), and owners and drivers type Greek on English pages. Marked
 * `lang="el"` (WCAG 3.1.2), a screen reader reads those words with a Greek voice instead of
 * spelling them out letter by letter. On a Greek page there is nothing to mark.
 */
export function greekRuns(text: string, lang: string): TextRun[] {
  if (lang === 'el' || !text) return [{ text }];
  const runs: TextRun[] = [];
  let from = 0;
  for (const match of text.matchAll(GREEK_RUN)) {
    if (match.index > from) runs.push({ text: text.slice(from, match.index) });
    runs.push({ text: match[0], lang: 'el' });
    from = match.index + match[0].length;
  }
  if (from < text.length) runs.push({ text: text.slice(from) });
  return runs;
}
