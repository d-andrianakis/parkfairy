import type { AdminOverstay } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { resolveOverstay } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';

import { OverstayActions } from './overstay-actions';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  resolveOverstay: vi.fn(),
}));

const render = rendererFor(CLIENT_NAMESPACES.overstay);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const ok = { ok: true as const, data: {} as AdminOverstay };
const refused = (code: string, status = 409) => ({ ok: false as const, failure: { code }, status });
const start = () => userEvent.click(screen.getByRole('button', { name: 'Close this report…' }));
const ticket = async (text = 'Ticket 7001.') => {
  await userEvent.click(screen.getByLabelText(/What was done\?/));
  await userEvent.paste(text);
};

beforeEach(() => vi.mocked(resolveOverstay).mockReset());

describe('closing an overstay report (#76)', () => {
  it('says that nothing else follows, wants a note, and asks once more', async () => {
    const { container } = render(<OverstayActions id={ID} canResolve own={false} />);
    expect(screen.getByText(/no money moves and nobody is told/)).toBeInTheDocument();
    await start();
    expect(screen.getByLabelText(/What was done\?/)).toHaveAttribute('aria-invalid', 'true');
    expect(resolveOverstay).not.toHaveBeenCalled();
    await ticket();
    await start();
    const question = screen.getByText('Close this report now? This can’t be undone.');
    await waitFor(() => expect(question).toHaveFocus());
    await expectNoAxeViolations(container);
  });

  it('sends the trimmed note, then a heading takes the focus and stays after the refresh', async () => {
    vi.mocked(resolveOverstay).mockResolvedValue(ok);
    const view = render(<OverstayActions id={ID} canResolve own={false} />);
    await ticket('  Ticket 7001, owner called.  ');
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, close it' }));
    expect(resolveOverstay).toHaveBeenCalledWith(ID, 'Ticket 7001, owner called.');
    const heading = await screen.findByRole('heading', { name: 'Report closed' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
    view.rerender(<OverstayActions id={ID} canResolve={false} own={false} />);
    expect(screen.getByRole('heading', { name: 'Report closed' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to do here/)).toBeNull();
  });

  it('says why when someone closed it first, and keeps the reason when the page catches up', async () => {
    vi.mocked(resolveOverstay).mockResolvedValue(refused('ALREADY_RESOLVED'));
    const view = render(<OverstayActions id={ID} canResolve own={false} />);
    await ticket();
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, close it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone closed this report already',
    );
    view.rerender(<OverstayActions id={ID} canResolve={false} own={false} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it.each([
    ['OWN_LISTING', 403, /own, co-own or manage this listing/],
    ['OVERSTAY_NOT_FOUND', 404, /no longer exists/],
    ['MFA_REQUIRED', 403, /Two-factor verification must be on/],
  ])('says %s in words', async (code, status, text) => {
    vi.mocked(resolveOverstay).mockResolvedValue(refused(code, status));
    render(<OverstayActions id={ID} canResolve own={false} />);
    await ticket();
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, close it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('refuses a note too long or with hidden characters, and asks nothing', async () => {
    render(<OverstayActions id={ID} canResolve own={false} />);
    await ticket('x'.repeat(101));
    await start();
    expect(screen.getByLabelText(/What was done\?/)).toHaveAccessibleDescription(/too long/);
    await userEvent.clear(screen.getByLabelText(/What was done\?/));
    await userEvent.paste('Hidden\u202Etext');
    await start();
    expect(screen.getByLabelText(/What was done\?/)).toHaveAttribute('aria-invalid', 'true');
    expect(resolveOverstay).not.toHaveBeenCalled();
  });

  it('offers nothing on a closed report, and says whose it is on one the reader runs', () => {
    const view = render(<OverstayActions id={ID} canResolve={false} own={false} />);
    expect(screen.getByText(/this report is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<OverstayActions id={ID} canResolve={false} own />);
    expect(screen.getByText(/someone else on the staff has to close/)).toBeInTheDocument();
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = render(<OverstayActions id={ID} canResolve own={false} />, {
      locale: 'el',
    });
    expect(screen.getByRole('button', { name: 'Κλείσιμο της αναφοράς…' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
