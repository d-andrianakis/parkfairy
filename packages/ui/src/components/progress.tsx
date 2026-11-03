'use client';

import * as React from 'react';
import { cn } from '@parkfairy/ui/lib/utils';
import { Progress as ProgressPrimitive } from 'radix-ui';

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      // Parkfairy: the border shows the whole length, which the faint track alone doesn't (3:1).
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full border border-input bg-primary/20',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // Parkfairy: forced colours drop background colours, which would blank the bar.
        className="h-full w-full flex-1 bg-primary transition-all motion-reduce:transition-none forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
