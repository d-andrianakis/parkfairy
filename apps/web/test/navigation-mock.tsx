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

export function setPathname(pathname: string) {
  currentPathname = pathname;
}

type LinkProps = Omit<ComponentProps<'a'>, 'href'> & { href: string; locale?: string };

/** Renders the URL next-intl would produce, without navigating (jsdom has no navigation). */
export function Link({ href, locale = 'en', onClick, ...props }: LinkProps) {
  return (
    <a
      href={`/${locale}${href === '/' ? '' : href}`}
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
export const redirect = vi.fn();
export const getPathname = vi.fn();
