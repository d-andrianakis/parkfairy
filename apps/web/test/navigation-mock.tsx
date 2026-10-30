import type { ComponentProps, MouseEvent } from 'react';
import { vi } from 'vitest';

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let currentPathname = '/';
let currentSearchParams = new URLSearchParams();

export function setPathname(pathname: string, search = '') {
  currentPathname = pathname;
  currentSearchParams = new URLSearchParams(search);
}

type Href = string | { pathname: string; query?: Record<string, string> };
type LinkProps = Omit<ComponentProps<'a'>, 'href'> & { href: Href; locale?: string };

function toPath(href: Href): string {
  if (typeof href === 'string') return href;
  const query = new URLSearchParams(href.query).toString();
  return query ? `${href.pathname}?${query}` : href.pathname;
}

/** Renders the URL next-intl would produce, without navigating (jsdom has no navigation). */
export function Link({ href, locale = 'en', onClick, ...props }: LinkProps) {
  const path = toPath(href);
  return (
    <a
      href={`/${locale}${path === '/' ? '' : path}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...props}
    />
  );
}

export const useRouter = () => routerMock;
export const usePathname = () => currentPathname;
export const useSearchParams = () => currentSearchParams;
export const redirect = vi.fn();
export const getPathname = vi.fn();
