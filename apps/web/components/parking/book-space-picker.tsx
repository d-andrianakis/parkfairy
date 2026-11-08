'use client';

import dynamic from 'next/dynamic';

/**
 * The space picker in a bundle of its own. Imported by the server page directly, it would ship
 * with every listing view, also where booking is off (staging and production until Phase 4) or
 * the visitor is signed out. Still rendered on the server, and loaded at once where it shows: it is
 * then the page's main control, so not on intent.
 */
export const BookSpacePicker = dynamic(() =>
  import('./book-space-form').then((module) => module.BookSpaceForm),
);
