import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from 'next-intl';
import type { ReactNode } from 'react';

type Messages = ReturnType<typeof useMessages>;
export type Namespace = keyof Messages;

/** The given catalog namespaces, and nothing else. */
export function pickMessages(messages: Messages, namespaces: readonly Namespace[]) {
  return Object.fromEntries(namespaces.map((namespace) => [namespace, messages[namespace]]));
}

/**
 * Ships only these namespaces to the client components below; everything else stays on the
 * server. It replaces (does not merge with) any outer provider, so list every namespace the
 * client components in this subtree use.
 */
export function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: readonly Namespace[];
  children: ReactNode;
}) {
  const messages = useMessages();
  const locale = useLocale();
  const timeZone = useTimeZone();
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      messages={pickMessages(messages, namespaces)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
