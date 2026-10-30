import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware replacements for next/link and next/navigation. Always import these instead. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

// Query strings carry no locale, so next-intl has no wrapper; re-exported here so every
// navigation hook comes from one module (and tests mock one module).
export { useSearchParams } from 'next/navigation';
