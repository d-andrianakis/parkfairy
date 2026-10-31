'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { keepFocusThroughUrlChange } from '@/components/route-focus';
import { usePathname, useRouter, useSearchParams } from '@/i18n/navigation';
import { SENT_PARAM } from './email-link-params';
import { forgetSentTo, recallSentTo, rememberSentTo } from './remembered-email';

/** Only `show` below writes the storage, and it sets state of its own. */
const neverChanges = () => () => {};

/**
 * The "check your inbox" panel that replaces a form, kept through a language switch (which
 * remounts the page) and a reload. `?sent=1` marks the state, so the server gets the title right
 * and the language switcher can carry it. The address stays out of the URL, where it would reach
 * logs; it waits in this tab's storage until the visitor is back on the plain form. With storage
 * blocked the panel still shows, but goes the way it used to on a switch.
 */
export function useSentPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const marked = useSearchParams()?.has(SENT_PARAM) ?? false;
  const [justSentTo, setJustSentTo] = useState<string | null>(null);
  const stored = useSyncExternalStore(
    neverChanges,
    () => recallSentTo(pathname),
    () => null,
  );

  // A link to the plain page (the header has one) leaves the panel without a remount.
  const [wasMarked, setWasMarked] = useState(marked);
  if (marked !== wasMarked) {
    setWasMarked(marked);
    if (!marked) setJustSentTo(null);
  }
  const sentTo = justSentTo ?? (marked ? stored : null);

  // A request can outlast the page: `show` must not mark the URL of wherever the visitor went.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!marked) forgetSentTo(pathname);
    // A copied link: this tab sent nothing, so it gets the form.
    else if (!recallSentTo(pathname)) router.replace(pathname);
  }, [marked, pathname, router]);

  // The panel renamed the tab, and the page isn't rendered again by going back to the same URL.
  const hadPanel = useRef(marked);
  useEffect(() => {
    if (hadPanel.current && !marked) router.refresh();
    hadPanel.current = marked;
  }, [marked, router]);

  return {
    sentTo,
    /** The URL says there is a panel, but the address can't be read until the page hydrates. */
    waiting: marked && !sentTo,
    show(email: string) {
      if (!mounted.current) return;
      setJustSentTo(email);
      if (rememberSentTo(pathname, email)) {
        // The history API, not the router: nothing on screen needs the server. It drops a dead
        // confirmation token too.
        keepFocusThroughUrlChange();
        window.history.replaceState(null, '', `?${SENT_PARAM}=1`);
      }
    },
  };
}
