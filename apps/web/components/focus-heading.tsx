'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Heading of what just replaced a form; takes the focus, which would otherwise be lost. With
 * `retitle` it also renames the tab, whose title still describes the form.
 */
export function FocusHeading({
  level: Heading = 'h2',
  retitle = false,
  children,
}: {
  level?: 'h2' | 'h3';
  retitle?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // Titles read "Page · Parkfairy" (the root layout's template): swap the page part.
    if (retitle)
      document.title = document.title.replace(/^.*(?= · )/, ref.current?.textContent ?? '');
  }, [retitle]);
  return (
    <Heading
      ref={ref}
      tabIndex={-1}
      className="rounded-sm text-base font-semibold outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </Heading>
  );
}
