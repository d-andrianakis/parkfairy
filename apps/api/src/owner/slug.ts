import { LISTING_LIMITS, SLUG_PATTERN } from '@parkfairy/contracts';

/** Latin for each Greek letter (accents are gone by the time this is read). */
const GREEK: Record<string, string> = {
  α: 'a',
  β: 'v',
  γ: 'g',
  δ: 'd',
  ε: 'e',
  ζ: 'z',
  η: 'i',
  θ: 'th',
  ι: 'i',
  κ: 'k',
  λ: 'l',
  μ: 'm',
  ν: 'n',
  ξ: 'x',
  ο: 'o',
  π: 'p',
  ρ: 'r',
  σ: 's',
  ς: 's',
  τ: 't',
  υ: 'y',
  φ: 'f',
  χ: 'ch',
  ψ: 'ps',
  ω: 'o',
};

/** Pairs that read as one sound: `Γκαράζ` is `garaz`, not `gkaraz`, and `Σκουφά` isn't `skoyfa`. */
const GREEK_PAIRS: [RegExp, string][] = [
  [/ου/g, 'ou'],
  [/αυ/g, 'av'],
  [/ευ/g, 'ev'],
  [/γκ/g, 'g'],
  [/μπ/g, 'b'],
  [/ντ/g, 'd'],
];

const MAX_BASE = LISTING_LIMITS.slug - 9; // room for `-` and a suffix on a collision

/** `/v1/parking/<these>` are other routes, and `draft-` marks a slug nobody should see. */
const taken = (slug: string) => ['search', 'featured'].includes(slug) || slug.startsWith('draft-');

/** A readable URL key for a listing's name; `parking` when nothing in the name survives. */
export function slugFromName(name: string): string {
  let text = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  for (const [pattern, latin] of GREEK_PAIRS) text = text.replace(pattern, latin);
  const slug = [...text]
    .map((letter) => GREEK[letter] ?? letter)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_BASE)
    .replace(/^-+|-+$/g, '');
  if (!SLUG_PATTERN.test(slug)) return 'parking';
  return taken(slug) ? `parking-${slug}` : slug;
}
