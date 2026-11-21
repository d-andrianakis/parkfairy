import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepPasses } from '@/lib/offline-pass';

import { PassGuard } from './pass-guard';

vi.mock('@/lib/offline-pass', () => ({ sweepPasses: vi.fn(() => Promise.resolve()) }));

beforeEach(() => vi.clearAllMocks());

describe('PassGuard (5A.3)', () => {
  it('asks the sweep, once the page is up, who is signed in', () => {
    const { container } = render(<PassGuard signedIn userId="u1" />);
    expect(sweepPasses).toHaveBeenCalledWith({ signedIn: true, userId: 'u1' });
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when no one is', () => {
    render(<PassGuard signedIn={false} userId={null} />);
    expect(sweepPasses).toHaveBeenCalledWith({ signedIn: false, userId: null });
  });

  it('asks again when the account changes, not on every render', () => {
    const { rerender } = render(<PassGuard signedIn userId="u1" />);
    rerender(<PassGuard signedIn userId="u1" />);
    expect(sweepPasses).toHaveBeenCalledTimes(1);
    rerender(<PassGuard signedIn userId="u2" />);
    expect(sweepPasses).toHaveBeenCalledTimes(2);
  });
});
