import type { ReactNode } from 'react';

/**
 * What a page at `?sent=1` shows until it can read the address, which the server can't: the
 * heading, so the page matches its title, and about the panel's height, so nothing jumps. Not
 * a `FocusHeading`: focus goes to the real panel.
 */
export function SentPlaceholder({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <h2 className="text-base font-semibold">{children}</h2>
    </div>
  );
}
