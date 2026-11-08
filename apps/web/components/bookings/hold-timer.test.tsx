import { extendMyHold } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { HOLD_WARNING_MS, HoldTimer } from './hold-timer';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  extendMyHold: vi.fn(),
}));
const extend = vi.mocked(extendMyHold);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);
const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HoldTimer', () => {
  it('warns two minutes before the hold ends, and reads the page again when it does', () => {
    vi.useFakeTimers();
    renderInSubtree(<HoldTimer id={ID} expiresAt={inMinutes(5)} extensionsLeft={10} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5 * 60_000 - HOLD_WARNING_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('Your hold on this space ends at');
    expect(routerMock.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(HOLD_WARNING_MS));
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it('warns at once when it opens with under two minutes left', () => {
    vi.useFakeTimers();
    renderInSubtree(<HoldTimer id={ID} expiresAt={inMinutes(1)} extensionsLeft={10} />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('keeps the hold for ten more minutes at a press, and says until when', async () => {
    const until = inMinutes(10);
    extend.mockResolvedValue(
      answer({ id: ID, holdExpiresAt: until, holdExtensionsLeft: 9 }) as never,
    );
    const { container } = renderInSubtree(
      <HoldTimer id={ID} expiresAt={inMinutes(3)} extensionsLeft={10} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Keep it for 10 more minutes' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Kept for you until'));
    expect(extend).toHaveBeenCalledWith({ path: { id: ID } });
    expect(routerMock.refresh).toHaveBeenCalledOnce();
    await expectNoAxeViolations(container);
  });

  it('says when it can be kept no longer, instead of offering to', () => {
    renderInSubtree(<HoldTimer id={ID} expiresAt={inMinutes(8)} extensionsLeft={0} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/kept as long as it can be/)).toBeInTheDocument();
  });

  it('says why a press was refused, in Greek', async () => {
    extend.mockResolvedValue(refusal('HOLD_LIMIT_REACHED') as never);
    renderInSubtree(<HoldTimer id={ID} expiresAt={inMinutes(8)} extensionsLeft={1} />, {
      locale: 'el',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Κρατήστε τη για άλλα 10 λεπτά' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('δεν μπορεί να κρατηθεί άλλο');
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});
