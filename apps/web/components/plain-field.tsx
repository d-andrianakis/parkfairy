'use client';

import { Field, FieldError } from '@parkfairy/ui/components/field';
import type { ComponentProps } from 'react';

/*
 * shadcn Field and FieldError without their default roles: an unnamed role="group" around
 * every single-control field (an extra screen-reader stop), and role="alert" on every inline
 * error (each one interrupts; errors are read with their field via aria-describedby instead).
 *
 * The override must run on the client: `role={undefined}` passed from a server component is
 * dropped crossing the RSC boundary and the defaults come back (memory.md).
 */

export function PlainField(props: ComponentProps<typeof Field>) {
  return <Field {...props} role={undefined} />;
}

export function PlainFieldError(props: ComponentProps<typeof FieldError>) {
  return <FieldError {...props} role={undefined} />;
}
