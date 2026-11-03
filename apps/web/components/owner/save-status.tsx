'use client';

import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Saves a field when the owner leaves it, so a half-finished step is there when they come back.
 * `save` gets only values that changed since the last save; the caller decides what is valid.
 */
export function useAutosave(save: (name: string, value: unknown) => Promise<boolean>) {
  const [state, setState] = useState<SaveState>('idle');
  const saved = useRef(new Map<string, unknown>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const autosave = useCallback(
    (name: string, value: unknown) => {
      if (saved.current.get(name) === value) return;
      saved.current.set(name, value);
      setState('saving');
      // One at a time and in order, so a slow save can't overwrite a newer one.
      queue.current = queue.current.then(async () => {
        const ok = await save(name, value);
        if (!ok) saved.current.delete(name);
        setState(ok ? 'saved' : 'failed');
      });
    },
    [save],
  );

  /** Marks a value as already stored, so leaving the field untouched saves nothing. */
  const remember = useCallback((name: string, value: unknown) => {
    saved.current.set(name, value);
  }, []);

  return { state, autosave, remember, settled: () => queue.current };
}

/**
 * Says whether what was typed is safe. "Saving" is only shown: spoken, every field left would say
 * two things. The rest is polite, in a region that is always there, so nothing moves and it exists
 * before it has something to say.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  const t = useTranslations('Owner.save');
  return (
    <div className="flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground">
      {state === 'saving' ? (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          <span aria-hidden>{t('saving')}</span>
        </>
      ) : null}
      {state === 'saved' ? <CircleCheck aria-hidden className="size-4" /> : null}
      <p role="status">
        {state === 'saved' ? t('saved') : null}
        {state === 'failed' ? t('failed') : null}
      </p>
    </div>
  );
}
