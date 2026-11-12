import type { Appearance } from '@stripe/stripe-js';

/**
 * Our colour tokens as hex, for Stripe's fields: they are in Stripe's frame, which can't read our
 * CSS, and Stripe takes no oklch. Held to globals.css by tokens.test.ts, as the emails' primary.
 */
export const STRIPE_LIGHT = {
  background: '#ffffff',
  foreground: '#020618',
  muted: '#45556c',
  border: '#62748e',
  primary: '#092c99',
  destructive: '#c10007',
  ring: '#162456',
} as const;

export const STRIPE_DARK = {
  background: '#020618',
  foreground: '#f8fafc',
  muted: '#90a1b9',
  border: '#62748e',
  primary: '#3a85ea',
  destructive: '#ff6467',
  ring: '#8ec5ff',
} as const;

/**
 * The Payment Element in our theme (decision #49): our text, borders and focus ring, so its
 * contrast is ours to answer for (WCAG 1.4.3, 1.4.11, 2.4.7), labels above their fields, and no
 * motion for those who asked for none.
 */
export function stripeAppearance(dark: boolean, reducedMotion: boolean): Appearance {
  const colour = dark ? STRIPE_DARK : STRIPE_LIGHT;
  const focus = { outline: `3px solid ${colour.ring}`, outlineOffset: '1px', boxShadow: 'none' };
  return {
    theme: dark ? 'night' : 'stripe',
    labels: 'above',
    variables: {
      colorPrimary: colour.primary,
      colorBackground: colour.background,
      colorText: colour.foreground,
      colorTextSecondary: colour.muted,
      colorDanger: colour.destructive,
      borderRadius: '6px',
    },
    rules: {
      '.Input': { border: `1px solid ${colour.border}`, boxShadow: 'none' },
      '.Input:focus': { ...focus, borderColor: colour.ring },
      '.Input--invalid': { borderColor: colour.destructive, boxShadow: 'none' },
      '.Tab': { border: `1px solid ${colour.border}` },
      '.Tab:focus': focus,
      '.Tab--selected': { borderColor: colour.primary, boxShadow: `0 0 0 1px ${colour.primary}` },
      '.CheckboxInput:focus': focus,
      ...(reducedMotion ? { '*': { transition: 'none' } } : {}),
    },
  };
}
