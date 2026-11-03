'use client';

import { useState } from 'react';

/**
 * A polite live region that speaks every time, including when the same text comes twice: it is
 * cleared first, because a region whose text doesn't change says nothing. Render `region` always,
 * so it exists before it has something to say. `className` shows it to everyone, for messages
 * that aren't only for screen readers.
 */
export function useAnnouncer(className = 'sr-only') {
  const [message, setMessage] = useState('');

  function announce(text: string) {
    setMessage('');
    requestAnimationFrame(() => setMessage(text));
  }

  const region = (
    <p role="status" className={className}>
      {message}
    </p>
  );
  return { announce, region };
}
