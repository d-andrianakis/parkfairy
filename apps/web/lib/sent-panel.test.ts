import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepFocusThroughUrlChange } from '@/components/route-focus';
import { routerMock, setPathname } from '@/test/navigation-mock';
import { useSentPanel } from './sent-panel';

vi.mock('@/components/route-focus', () => ({ keepFocusThroughUrlChange: vi.fn() }));

const STORED = 'parkfairy.sent-to:/sign-up';
const ADDRESS = 'maria@example.gr';

describe('useSentPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setPathname('/sign-up');
    routerMock.replace.mockReset();
    routerMock.refresh.mockReset();
    vi.mocked(keepFocusThroughUrlChange).mockClear();
    window.history.replaceState(null, '', '/en/sign-up');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setPathname('/');
  });

  it('starts on the form', () => {
    const { result } = renderHook(() => useSentPanel());
    expect(result.current).toMatchObject({ sentTo: null, waiting: false });
  });

  it('marks the URL without the address, and keeps the address in this tab', () => {
    const { result } = renderHook(() => useSentPanel());

    act(() => result.current.show(ADDRESS));

    expect(result.current.sentTo).toBe(ADDRESS);
    expect(window.location.pathname + window.location.search).toBe('/en/sign-up?sent=1');
    expect(window.location.href).not.toContain('maria');
    expect(sessionStorage.getItem(STORED)).toBe(ADDRESS);
  });

  it('keeps the focus on the panel through that URL change', () => {
    const { result } = renderHook(() => useSentPanel());

    act(() => result.current.show(ADDRESS));

    expect(keepFocusThroughUrlChange).toHaveBeenCalledOnce();
  });

  it('leaves the URL alone if the visitor left before the answer came', () => {
    const { result, unmount } = renderHook(() => useSentPanel());
    const { show } = result.current;
    unmount();
    window.history.replaceState(null, '', '/en/search?area=syntagma');

    show(ADDRESS);

    expect(window.location.search).toBe('?area=syntagma');
    expect(sessionStorage.getItem(STORED)).toBeNull();
    expect(keepFocusThroughUrlChange).not.toHaveBeenCalled();
  });

  it('drops a dead token from the URL along the way', () => {
    window.history.replaceState(null, '', '/en/verify-email?token=dead');
    const { result } = renderHook(() => useSentPanel());

    act(() => result.current.show(ADDRESS));

    expect(window.location.search).toBe('?sent=1');
  });

  it('brings the panel back after a language switch or a reload', () => {
    sessionStorage.setItem(STORED, ADDRESS);
    setPathname('/sign-up', 'sent=1');

    const { result } = renderHook(() => useSentPanel());

    expect(result.current).toMatchObject({ sentTo: ADDRESS, waiting: false });
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('waits on the server, then fills in the address when the page hydrates', async () => {
    function Panel() {
      const { sentTo, waiting } = useSentPanel();
      return createElement('p', null, waiting ? 'waiting' : sentTo);
    }
    const mismatch = vi.spyOn(console, 'error');
    sessionStorage.setItem(STORED, ADDRESS);
    setPathname('/sign-up', 'sent=1');
    const host = document.body.appendChild(document.createElement('div'));

    host.innerHTML = renderToString(createElement(Panel));
    expect(host).toHaveTextContent('waiting');

    const root = await act(() => Promise.resolve(hydrateRoot(host, createElement(Panel))));
    expect(host).toHaveTextContent(ADDRESS);
    expect(mismatch).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it('sends a copied link to the form: this tab sent nothing', () => {
    setPathname('/sign-up', 'sent=1');

    const { result } = renderHook(() => useSentPanel());

    expect(result.current).toMatchObject({ sentTo: null, waiting: true });
    expect(routerMock.replace).toHaveBeenCalledExactlyOnceWith('/sign-up');
  });

  it('keeps panels of different pages apart', () => {
    sessionStorage.setItem('parkfairy.sent-to:/forgot-password', ADDRESS);
    setPathname('/sign-up', 'sent=1');

    const { result } = renderHook(() => useSentPanel());

    expect(result.current.sentTo).toBeNull();
  });

  it('forgets the address once the visitor is back on the plain form', () => {
    sessionStorage.setItem(STORED, ADDRESS);
    renderHook(() => useSentPanel());
    expect(sessionStorage.getItem(STORED)).toBeNull();
  });

  it('goes back to the form when a link leaves the panel, without a remount', () => {
    const { result, rerender } = renderHook(() => useSentPanel());
    act(() => result.current.show(ADDRESS));
    setPathname('/sign-up', 'sent=1');
    rerender();
    expect(result.current.sentTo).toBe(ADDRESS);

    setPathname('/sign-up');
    rerender();

    expect(result.current).toMatchObject({ sentTo: null, waiting: false });
    expect(sessionStorage.getItem(STORED)).toBeNull();
    expect(routerMock.refresh).toHaveBeenCalledOnce(); // the tab still names the panel
  });

  it('still shows the panel with storage blocked, leaving the URL alone', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useSentPanel());

    act(() => result.current.show(ADDRESS));

    expect(result.current.sentTo).toBe(ADDRESS);
    expect(window.location.search).toBe('');
  });

  it('copes with storage that cannot even be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setPathname('/sign-up', 'sent=1');

    expect(() => renderHook(() => useSentPanel())).not.toThrow();
    expect(routerMock.replace).toHaveBeenCalledExactlyOnceWith('/sign-up');
  });
});
