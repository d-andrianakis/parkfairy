'use client';

import type { PlaceSuggestion } from '@parkfairy/api-client';
import { Popover, PopoverAnchor, PopoverContent } from '@parkfairy/ui/components/popover';
import { useEffect, type RefObject } from 'react';
import { optionId } from './place-option-id';

export interface PlaceSuggestionListProps {
  /** The address field: the list hangs from it, and the focus never leaves it. */
  anchor: RefObject<HTMLInputElement | null>;
  /** Right after the field, so the list follows it in the reading order. */
  container: HTMLElement | null;
  id: string;
  label: string;
  suggestions: PlaceSuggestion[];
  active: number;
  onPick: (index: number) => void;
  onActive: (index: number) => void;
  onDismiss: () => void;
}

/**
 * The suggestions under the address field: the popup of an ARIA 1.2 combobox, so the list itself
 * is the popover (`role="listbox"`) and holds options only. The field keeps the focus throughout,
 * and says which option is current with `aria-activedescendant`; that option shows an inset ring
 * (the accent fill alone is 1.1:1 on the popover) and an outline forced-colors mode can draw. A
 * press on an option doesn't take the focus either. In a bundle of its own, loaded when the field
 * is first used.
 */
export function PlaceSuggestionList({
  anchor,
  container,
  id,
  label,
  suggestions,
  active,
  onPick,
  onActive,
  onDismiss,
}: PlaceSuggestionListProps) {
  // The arrows can go past what the list shows on a short screen.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(id, active))?.scrollIntoView?.({ block: 'nearest' });
  }, [id, active]);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLInputElement>} />
      <PopoverContent
        container={container}
        id={id}
        role="listbox"
        aria-label={label}
        align="start"
        className="max-h-[min(18rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-64 overflow-y-auto p-1"
        // The field keeps the focus: typing goes on while the list shows.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target === anchor.current) event.preventDefault();
        }}
      >
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion.id}
            id={optionId(id, index)}
            role="option"
            aria-selected={index === active}
            className="group/option grid cursor-default rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground aria-selected:ring-2 aria-selected:ring-ring aria-selected:outline-hidden aria-selected:ring-inset"
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => {
              if (index !== active) onActive(index);
            }}
            onClick={() => onPick(index)}
          >
            <span className="font-medium">{suggestion.name}</span>
            {suggestion.detail ? (
              <span className="text-xs text-muted-foreground group-aria-selected/option:text-accent-foreground">
                {suggestion.detail}
              </span>
            ) : null}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
