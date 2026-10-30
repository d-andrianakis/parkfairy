import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRefresh } from './session-refresh';

describe('SessionRefresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the auth handler for the session, which renews the cookie', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SessionRefresh />);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/get-session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves no unhandled rejection when offline (the next page load tries again)', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
      render(<SessionRefresh />);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
