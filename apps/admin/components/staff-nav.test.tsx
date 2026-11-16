import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setPathname } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { StaffNav } from './staff-nav';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';

const render = rendererFor(CLIENT_NAMESPACES.root);

beforeEach(() => setPathname('/'));

describe('the staff navigation', () => {
  it('offers the staff screens, in order, under one label', () => {
    render(<StaffNav />);
    const nav = screen.getByRole('navigation', { name: 'Staff' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Listings', 'Accounts', 'Audit log']);
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute(
      'href',
      '/en/users',
    );
    expect(within(nav).queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('marks the screen you are on in words for a screen reader, and its sub-pages too', () => {
    setPathname('/users');
    const { unmount } = render(<StaffNav />);
    expect(screen.getByRole('link', { name: 'Accounts', current: 'page' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
    unmount();
    setPathname('/users/7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f');
    render(<StaffNav />);
    expect(screen.getByRole('link', { name: 'Accounts', current: 'page' })).toBeInTheDocument();
  });

  it('is the same in Greek, and does not mistake a longer path for another screen', () => {
    setPathname('/listings');
    render(<StaffNav />, { locale: 'el' });
    expect(screen.getByRole('navigation', { name: 'Προσωπικό' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Λογαριασμοί' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Χώροι', current: 'page' })).toBeInTheDocument();
  });
});
