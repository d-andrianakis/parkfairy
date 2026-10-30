import * as React from 'react';
import { cn } from '@parkfairy/ui/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      // Parkfairy: text-foreground (Field turns invalid text red: 4.4:1 on the dark input),
      // solid invalid focus ring (was 20%/40%: 1.4:1), outline-hidden on focus so forced-colors
      // mode still shows focus (box-shadow rings are dropped there).
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs text-foreground transition-[color,box-shadow] outline-none focus-visible:outline-hidden selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
