'use client';

import { Button } from '@parkfairy/ui/components/button';
import { cn } from '@parkfairy/ui/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type ComponentProps } from 'react';
import { FormField } from './form-field';

const neverChanges = () => () => {};

/**
 * Whether a password is shown. In the form so it can `hide` once validation has passed: browsers
 * keep text fields in their autofill history and password managers only save password fields,
 * but someone told their password is too short needs to go on seeing it.
 */
export function usePasswordReveal() {
  const [shown, setShown] = useState(false);
  return { shown, toggle: () => setShown(!shown), hide: () => setShown(false) };
}

/**
 * A password input with a button that shows what was typed. One name and `aria-pressed`, so the
 * button says what it does whatever its state. It appears only once the page can run it: forms
 * here work before hydration, and a button that does nothing helps nobody.
 */
export function PasswordField({
  id,
  className,
  reveal,
  ...props
}: Omit<ComponentProps<typeof FormField>, 'type' | 'endControl'> & {
  reveal: ReturnType<typeof usePasswordReveal>;
}) {
  const t = useTranslations('Forms');
  const interactive = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );

  const Icon = reveal.shown ? EyeOff : Eye;
  return (
    <FormField
      id={id}
      type={reveal.shown ? 'text' : 'password'}
      // While shown it is a text field, and spell checkers may send those to a server.
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      // Edge's own reveal button would sit beside ours.
      className={cn('pe-11 [&::-ms-reveal]:hidden', className)}
      endControl={
        interactive ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // Solid ring: this one sits on the input's fill, where the usual 50% falls below 3:1.
            className="absolute end-0.5 top-1/2 size-8 -translate-y-1/2 text-muted-foreground focus-visible:ring-ring"
            aria-label={t('showPassword')}
            aria-pressed={reveal.shown}
            aria-controls={id}
            onClick={reveal.toggle}
          >
            <Icon aria-hidden="true" />
          </Button>
        ) : null
      }
      {...props}
    />
  );
}
