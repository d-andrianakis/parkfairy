import { screen } from '@testing-library/react';
import { useMessages } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { getLayoutSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import OwnerLayout from './layout';

vi.mock('@/lib/session', () => ({ getLayoutSession: vi.fn() }));
const signedIn = { user: { id: 'u' }, session: { id: 's' } } as Awaited<
  ReturnType<typeof getLayoutSession>
>;

function Namespaces() {
  return <p>{Object.keys(useMessages()).sort().join(' ')}</p>;
}

describe('the owner layout', () => {
  it('gives every owner page the owner namespaces, and only those', async () => {
    vi.mocked(getLayoutSession).mockResolvedValueOnce(signedIn);
    renderWithProviders(<>{await OwnerLayout({ children: <Namespaces /> })}</>);
    expect(screen.getByText([...CLIENT_NAMESPACES.owner].sort().join(' '))).toBeInTheDocument();
  });

  it('adds none to the signed-out landing, which has no client components to read them', async () => {
    vi.mocked(getLayoutSession).mockResolvedValueOnce(null);
    renderWithProviders(<>{await OwnerLayout({ children: <Namespaces /> })}</>, {
      namespaces: ['Header'],
    });
    expect(screen.getByText('Header')).toBeInTheDocument();
  });
});
