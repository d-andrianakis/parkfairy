import { Circle, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/** The ring every step link shares; the browser's own is too faint on a muted row. */
export const STEP_LINK =
  'flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden';

/**
 * A step's name and state, as an icon and text, so it never rests on colour or shape alone. The
 * state comes after the name, so a list of links can be scanned by name.
 */
export function StepRow({ done, children }: { done: boolean; children: ReactNode }) {
  const t = useTranslations('Owner.state');
  return (
    <>
      {done ? (
        <CircleCheck aria-hidden className="size-5 shrink-0 text-primary" />
      ) : (
        <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      )}
      {children}
      <span className="sr-only"> {done ? t('done') : t('todo')}</span>
    </>
  );
}
