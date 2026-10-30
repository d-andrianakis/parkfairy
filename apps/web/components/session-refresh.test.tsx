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

  it('ignores a failed request (the next page load tries again)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionRefresh />);
    await expect(fetchMock.mock.results[0]?.value).rejects.toThrow('offline');
  });
});
