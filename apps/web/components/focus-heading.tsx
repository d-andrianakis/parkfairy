'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Heading of what just replaced a form; takes the focus, which would otherwise be lost. Not from
 * anywhere else, though: this can appear after a slow request or a slow hydration, and someone who
 * has moved on by then keeps their place, and hears it instead. With `retitle` it also renames the
 * tab, whose title still describes the form.
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
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // Nothing in particular: where the focus falls when its form goes, or where a route change
    // puts it (`RouteFocus`).
    const active = document.activeElement;
    if (!active || active === document.body || active.id === 'main-content') ref.current?.focus();
    else if (status.current) status.current.textContent = ref.current?.textContent ?? '';
    // Titles read "Page · Parkfairy" (the root layout's template): swap the page part.
    if (retitle)
      document.title = document.title.replace(/^.*(?= · )/, ref.current?.textContent ?? '');
  }, [retitle]);
  return (
    <>
      <Heading
        ref={ref}
        tabIndex={-1}
        className="rounded-sm text-base font-semibold outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {children}
      </Heading>
      {/* Empty until then: live regions only speak up about what changes inside them. */}
      <p ref={status} role="status" className="sr-only" />
    </>
  );
}
