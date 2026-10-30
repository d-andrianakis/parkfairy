import { DEFAULT_TIME_ZONE, type Locale } from '@parkfairy/contracts';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// RouteFocus keeps the last page in module scope (it must survive the [locale] remount), so
// every test starts from a fresh module. `setPathname` must come from the same (mocked)
// navigation module instance that RouteFocus reads.
type NavigationMock = typeof import('@/test/navigation-mock');
let RouteFocus: typeof import('./route-focus').RouteFocus;
let setPathname: NavigationMock['setPathname'];
beforeEach(async () => {
  vi.resetModules();
  ({ RouteFocus } = await import('./route-focus'));
  ({ setPathname } = (await import('@/i18n/navigation')) as unknown as NavigationMock);
});

function Page({ locale = 'en' }: { locale?: Locale }) {
  return (
    <NextIntlClientProvider locale={locale} messages={{}} timeZone={DEFAULT_TIME_ZONE}>
      <button type="button">elsewhere</button>
      <main id="main-content" tabIndex={-1}>
        <RouteFocus />
      </main>
    </NextIntlClientProvider>
  );
}

const main = () => document.getElementById('main-content');

describe('RouteFocus', () => {
  it('leaves focus alone on first load', () => {
    setPathname('/search', 'area=syntagma');
    render(<Page />);
    expect(document.body).toHaveFocus();
  });

  it('moves focus to the main content after a client-side navigation', () => {
    setPathname('/search', 'area=syntagma');
    const { rerender, getByRole } = render(<Page />);
    getByRole('button').focus();

    setPathname('/parking/syntagma-square-garage');
    rerender(<Page />);
    expect(main()).toHaveFocus();
  });

  it('treats a new query as a new page (another search)', () => {
    setPathname('/search', 'area=syntagma');
    const { rerender, getByRole } = render(<Page />);
    getByRole('button').focus();

    setPathname('/search', 'area=ladadika');
    rerender(<Page />);
    expect(main()).toHaveFocus();
  });

  it('leaves focus alone when re-rendered on the same page (hash links, state updates)', () => {
    setPathname('/search', 'area=syntagma');
    const { rerender, getByRole } = render(<Page />);
    getByRole('button').focus();

    rerender(<Page />);
    expect(getByRole('button')).toHaveFocus();
  });

  it('counts a language switch as a navigation, although the layout remounts', () => {
    setPathname('/search', 'area=syntagma');
    render(<Page locale="en" />).unmount();

    render(<Page locale="el" />);
    expect(main()).toHaveFocus();
  });

  it('leaves focus alone on Back/Forward, where the browser restores the position', () => {
    setPathname('/search', 'area=syntagma');
    const { rerender, getByRole } = render(<Page />);
    getByRole('button').focus();

    window.dispatchEvent(new PopStateEvent('popstate'));
    setPathname('/parking/syntagma-square-garage');
    rerender(<Page />);
    expect(getByRole('button')).toHaveFocus();

    // The next ordinary navigation moves focus again.
    setPathname('/search', 'area=ladadika');
    rerender(<Page />);
    expect(main()).toHaveFocus();
  });
});
