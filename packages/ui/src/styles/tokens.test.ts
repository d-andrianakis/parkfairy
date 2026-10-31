// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrast of the theme tokens, computed from globals.css. axe in the smoke suite only sees
 * colours that are on a page today; this covers the pairings our components produce, in
 * both themes, including tokens no page uses yet (status, highlight). Add a pair whenever a
 * component combines tokens in a new way.
 */

type Rgba = { rgb: [number, number, number]; alpha: number; inGamut?: boolean };

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} not found in globals.css`);
  return css.slice(start, css.indexOf('}', start));
}

/** `--name: oklch(L C H [/ A%])` declarations → gamma-encoded sRGB (+ alpha). */
function tokens(selector: string): Record<string, Rgba> {
  const declarations = block(selector).matchAll(
    /--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)/g,
  );
  return Object.fromEntries(
    [...declarations].map(([, name = '', l, c, h, alpha]): [string, Rgba] => [
      name,
      { ...oklchToSrgb(Number(l), Number(c), Number(h)), alpha: alpha ? Number(alpha) / 100 : 1 },
    ]),
  );
}

// https://bottosson.github.io/posts/oklab/ (OKLab → linear sRGB), clamped to the gamut.
function oklchToSrgb(l: number, c: number, hue: number): Pick<Rgba, 'rgb' | 'inGamut'> {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  const [r = 0, g = 0, bl = 0] = linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  });
  return { rgb: [r, g, bl], inGamut: linear.every((v) => v > -1e-4 && v < 1 + 1e-4) };
}

/** Browsers composite translucent colours over the backdrop in gamma-encoded sRGB. */
function over(fg: Rgba, bg: Rgba, opacity = 1): Rgba {
  const alpha = fg.alpha * opacity;
  const [r = 0, g = 0, b = 0] = fg.rgb.map((v, i) => v * alpha + (bg.rgb[i] ?? 0) * (1 - alpha));
  return { rgb: [r, g, b], alpha: 1 };
}

function luminance({ rgb }: Rgba): number {
  const [r = 0, g = 0, b = 0] = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of `fg` (optionally at `opacity`) drawn on an opaque `bg`. */
function contrast(fg: Rgba, bg: Rgba, opacity = 1): number {
  const [hi, lo] = [luminance(over(fg, bg, opacity)), luminance(bg)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const TEXT = 4.5; // 1.4.3 normal-size text
const NON_TEXT = 3; // 1.4.11 field boundaries, focus indicators
/**
 * Saturated Tailwind colours sit just outside sRGB. Browsers gamut-map them (Chrome draws the
 * lab() value, the build adds its own hex fallback) and the result differs from the clamp
 * above: red-600 at 90% scored 4.52 here but failed axe in Chrome. Such pairs need headroom.
 */
const GAMUT_MARGIN = 0.15;

/** [foreground, background, minimum, opacity of the foreground as the components use it] */
const PAIRS: [string, string, number, number?][] = [
  ['foreground', 'background', TEXT],
  ['card-foreground', 'card', TEXT],
  ['popover-foreground', 'popover', TEXT],
  ['primary-foreground', 'primary', TEXT],
  ['secondary-foreground', 'secondary', TEXT],
  ['accent-foreground', 'accent', TEXT],
  ['muted-foreground', 'background', TEXT],
  ['muted-foreground', 'card', TEXT],
  ['muted-foreground', 'muted', TEXT],
  ['primary', 'background', TEXT], // links, `link` buttons
  ['primary', 'card', TEXT],
  ['destructive', 'background', TEXT], // field errors
  ['destructive', 'card', TEXT],
  ['destructive', 'card', TEXT, 0.9], // destructive Alert description
  ['highlight-foreground', 'highlight', TEXT],
  ['status-available-foreground', 'status-available', TEXT],
  ['status-limited-foreground', 'status-limited', TEXT],
  ['status-full-foreground', 'status-full', TEXT],
  ['input', 'background', NON_TEXT],
  ['input', 'card', NON_TEXT],
  ['ring', 'background', NON_TEXT, 0.5], // `focus-visible:ring-ring/50`
  ['ring', 'card', NON_TEXT, 0.5],
  ['ring', 'popover', NON_TEXT], // focused menu item: inset ring…
  ['ring', 'accent', NON_TEXT], // …drawn on the item's highlight
  ['destructive', 'background', NON_TEXT], // focused invalid field (`aria-invalid:ring-destructive`)
  ['destructive', 'card', NON_TEXT],
];

const light = tokens(':root');
const dark = tokens('@utility theme-dark-tokens');

it('the dark theme defines every colour the light theme defines', () => {
  expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
});

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_theme, palette) => {
  it.each(PAIRS)('%s on %s reaches %s:1', (fg, bg, minimum, opacity = 1) => {
    const foreground = palette[fg];
    const background = palette[bg];
    expect(foreground, fg).toBeDefined();
    expect(background, bg).toBeDefined();
    if (!foreground || !background) return;
    const margin = foreground.inGamut && background.inGamut ? 0 : GAMUT_MARGIN;
    expect(contrast(foreground, background, opacity)).toBeGreaterThanOrEqual(minimum + margin);
  });
});

// Inputs have a fill of their own in the dark theme (`dark:bg-input/30`), which PasswordField's
// toggle sits on: this is where the usual 50% ring once fell below 3:1, so its ring is solid.
describe('on the dark input fill', () => {
  it.each([
    ['ring', NON_TEXT],
    ['muted-foreground', TEXT],
  ] as const)('%s reaches %s:1', (fg, minimum) => {
    const { [fg]: foreground, input, background } = dark;
    expect(foreground && input && background).toBeDefined();
    if (!foreground || !input || !background) return;
    expect(contrast(foreground, over(input, background, 0.3))).toBeGreaterThanOrEqual(minimum);
  });
});
