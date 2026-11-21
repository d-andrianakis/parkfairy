import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { canKeepPasses, forgetPass, keepPass, keptUntil } from '@/lib/offline-pass';
import { rendererFor } from '@/test/render';

import { OfflinePass } from './offline-pass';

vi.mock('@/lib/offline-pass', () => ({
  canKeepPasses: vi.fn(),
  keepPass: vi.fn(),
  keptUntil: vi.fn(),
  forgetPass: vi.fn(),
}));
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.pass);

const PATH = '/en/bookings/6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c/pass';
const UNTIL = '2026-12-12T10:00:00.000Z';
const OWNER = 'a0a0a0a0-0000-4000-8000-000000000001';
const show = (locale: 'en' | 'el' = 'en') =>
  renderInSubtree(<OfflinePass path={PATH} until={UNTIL} owner={OWNER} />, { locale });
const keepButton = () => screen.findByRole('button', { name: 'Keep this pass offline' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canKeepPasses).mockReturnValue(true);
  vi.mocked(keptUntil).mockResolvedValue(null);
  vi.mocked(keepPass).mockResolvedValue(undefined);
  vi.mocked(forgetPass).mockResolvedValue(undefined);
});

describe('OfflinePass (5A.3)', () => {
  it('says what keeping does before it is pressed, and is accessible', async () => {
    const { container } = show();
    const button = await keepButton();
    expect(button).toHaveAccessibleDescription(/until a day after your stay/);
    expect(button).toHaveAccessibleDescription(/signing out removes it/);
    await expectNoAxeViolations(container);
  });

  it('shows nothing until the browser’s abilities are known, so no button flickers into place', () => {
    vi.mocked(canKeepPasses).mockReturnValue(false);
    show();
    // The first render is the server's: nothing; the effect then says it can't.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so where the browser can’t keep pages, with no button that would fail', async () => {
    vi.mocked(canKeepPasses).mockReturnValue(false);
    show();
    expect(await screen.findByText('This browser can’t keep pages offline.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the page until the end it was given, says until when, and offers to remove it', async () => {
    show();
    await userEvent.click(await keepButton());
    await waitFor(() => expect(keepPass).toHaveBeenCalledWith(PATH, new Date(UNTIL), OWNER));
    const remove = await screen.findByRole('button', { name: 'Remove from this device' });
    // What keeping means stays said once it is kept, with when it ends beside it.
    expect(remove).toHaveAccessibleDescription(/signing out removes it/);
    expect(screen.getAllByText(/Kept on this device until Dec 12, 2026/).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .map((region) => region.textContent)
          .join(' '),
      ).toMatch(/Kept on this device until/),
    );
    // The button pressed is the button there: the focus stays on it.
    expect(remove).toHaveFocus();
  });

  it('knows a pass was kept on an earlier visit, and takes it away on request', async () => {
    vi.mocked(keptUntil).mockResolvedValue(new Date(UNTIL));
    show();
    const remove = await screen.findByRole('button', { name: 'Remove from this device' });
    await userEvent.click(remove);
    await waitFor(() => expect(forgetPass).toHaveBeenCalledWith(PATH));
    expect(await keepButton()).toHaveFocus();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .map((region) => region.textContent)
          .join(' '),
      ).toContain('Removed from this device.'),
    );
  });

  it('says on a 24-hour clock in Greek when it ends', async () => {
    vi.mocked(keptUntil).mockResolvedValue(new Date(UNTIL));
    show('el');
    expect(await screen.findByText(/Αποθηκεύτηκε σε αυτή τη συσκευή μέχρι/)).toHaveTextContent(
      /12:00/,
    );
    expect(screen.queryByText(/μ\.μ\.|π\.μ\./)).toBeNull();
  });

  it('says it is removing, not saving, while a pass is taken away', async () => {
    vi.mocked(keptUntil).mockResolvedValue(new Date(UNTIL));
    let finish: () => void = () => {};
    vi.mocked(forgetPass).mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this device' }));
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeInTheDocument();
    finish();
    await keepButton();
  });

  it('says it could not take it away, and leaves the button as "Remove"', async () => {
    vi.mocked(keptUntil).mockResolvedValue(new Date(UNTIL));
    vi.mocked(forgetPass).mockRejectedValue(new Error('blocked'));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from this device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save it.');
    expect(screen.getByRole('button', { name: 'Remove from this device' })).toBeInTheDocument();
  });

  it('says it could not, in an alert, and leaves the pass not kept', async () => {
    vi.mocked(keepPass).mockRejectedValue(new Error('offline'));
    show();
    await userEvent.click(await keepButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save it.');
    expect(await keepButton()).toBeInTheDocument();
  });

  it('keeps once for a double press', async () => {
    let finish: () => void = () => {};
    vi.mocked(keepPass).mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    show();
    const button = await keepButton();
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(keepPass).toHaveBeenCalledOnce();
    finish();
    await screen.findByRole('button', { name: 'Remove from this device' });
  });

  it('speaks Greek', async () => {
    show('el');
    expect(
      await screen.findByRole('button', { name: 'Αποθήκευση της κάρτας για χρήση χωρίς σύνδεση' }),
    ).toBeInTheDocument();
  });
});
