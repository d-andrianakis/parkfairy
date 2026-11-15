'use client';

import { useLocale } from 'next-intl';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { loadPage } from '@/lib/load-page';

const LOCATION_STEP = /\/location$/;

/**
 * Goes to a step. The location step gets a real page load: a page's CSP comes with its document,
 * so anyone who moved here inside the app would keep the policy of the page they arrived on, and
 * the map would be refused.
 */
export function useStepNavigation() {
  const router = useRouter();
  const locale = useLocale();
  return (href: string) => {
    if (LOCATION_STEP.test(href)) loadPage(`/${locale}${href}`);
    else router.push(href);
  };
}

/** `Link`, or a plain link to the location step; see `useStepNavigation`. */
export function StepLink({
  href,
  children,
  ...props
}: Omit<ComponentProps<'a'>, 'href'> & { href: string; children: ReactNode }) {
  const locale = useLocale();
  return LOCATION_STEP.test(href) ? (
    <a href={`/${locale}${href}`} {...props}>
      {children}
    </a>
  ) : (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

/**
 * Moves the focus once React has finished: the control that had it may be going, and the one
 * taking over may only just exist, or only just stop being disabled. `onlyIfLost`: only if the
 * focus was let go (on the page, or its main), after an answer that took a while: someone who has
 * moved on meanwhile isn't pulled back.
 */
export function useFocusAfterRender({ onlyIfLost = false }: { onlyIfLost?: boolean } = {}) {
  const target = useRef<string | null>(null);
  const [, render] = useState(0);
  useEffect(() => {
    if (target.current === null) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || active.id === 'main-content';
    if (!onlyIfLost || lost) document.getElementById(target.current)?.focus();
    target.current = null;
  });
  return (id: string) => {
    target.current = id;
    render((count) => count + 1);
  };
}
