'use client';

import { type ReactNode, useState } from 'react';
import type { ZodType } from 'zod';

import { FocusHeading } from '@/components/focus-heading';
import { NoteConfirm, type NoteConfirmLabels } from '@/components/note-confirm';
import { StaleNotice } from '@/components/stale-notice';
import { useRouter } from '@/i18n/navigation';
import type { Outcome } from '@/lib/api-call';

/**
 * One change staff make to something with money or a person's access behind it: what it does in
 * words, a note, one more question, and then a heading that takes the focus. A refusal that says the
 * page is out of date (`stale`, by code) keeps its reason above whatever the refreshed page offers.
 * Callers key it by action, so one action's question is never carried into another's.
 */
export function ChangePanel({
  id,
  heading,
  text,
  schema,
  labels,
  extra,
  run,
  done,
  stale,
  available = true,
  onFinished,
}: {
  /** A stable word for this panel: its heading's id. */
  id: string;
  heading: string;
  text: string;
  schema: ZodType<{ note: string }, { note: string }>;
  labels: NoteConfirmLabels;
  extra?: ReactNode;
  run: (note: string) => Promise<Outcome<unknown>>;
  done: { title: string; text: string };
  /** Codes that say someone else got there first. */
  stale: readonly string[];
  /**
   * Whether the change can be made now. The page refreshes after one, and what it then offers is
   * different: a panel that has just finished stays to say so; one that never could shows nothing.
   */
  available?: boolean;
  onFinished?: () => void;
}) {
  const router = useRouter();
  const [finished, setFinished] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  if (finished) {
    return (
      <div className="grid gap-2">
        <FocusHeading level="h3">{done.title}</FocusHeading>
        <p className="text-sm text-muted-foreground">{done.text}</p>
      </div>
    );
  }
  // The reason stays in one place whatever else the refreshed page offers or no longer offers, so
  // it is announced and focused once, and a change of what stands beside it does not move it.
  return (
    <>
      {reason ? <StaleNotice message={reason} /> : null}
      {available ? (
        <section aria-labelledby={`${id}-heading`} className="grid gap-3">
          <h3 id={`${id}-heading`} className="font-semibold">
            {heading}
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">{text}</p>
          <NoteConfirm
            schema={schema}
            labels={labels}
            extra={extra}
            run={run}
            onDone={() => {
              setFinished(true);
              onFinished?.();
              router.refresh();
            }}
            onStale={(code, message) => {
              if (!code || !stale.includes(code)) return false;
              setReason(message);
              // Someone else got there first: the page behind this is no longer a place to say
              // that there is nothing to do.
              onFinished?.();
              router.refresh();
              return true;
            }}
            onAttempt={() => setReason(null)}
          />
        </section>
      ) : null}
    </>
  );
}
