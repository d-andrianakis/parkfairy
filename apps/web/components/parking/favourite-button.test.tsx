import { favouriteListing, unfavouriteListing } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';

import { FavouriteButton, RemoveFavouriteButton } from './favourite-button';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  favouriteListing: vi.fn(),
  unfavouriteListing: vi.fn(),
}));
const keep = vi.mocked(favouriteListing);
const letGo = vi.mocked(unfavouriteListing);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.favourite);
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FavouriteButton (5A.2)', () => {
  it('is a toggle named "Favourite", pressed when the listing is one', async () => {
    const { container } = renderInSubtree(<FavouriteButton slug="ermou" initial />);
    expect(screen.getByRole('button', { name: 'Favourite', pressed: true })).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('keeps the listing, says so once, and lets it go again', async () => {
    keep.mockResolvedValue(answer({ favourite: true }) as Result<typeof favouriteListing>);
    letGo.mockResolvedValue(answer({ favourite: false }) as Result<typeof unfavouriteListing>);
    renderInSubtree(<FavouriteButton slug="ermou" initial={false} />);
    const button = screen.getByRole('button', { name: 'Favourite', pressed: false });
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(keep).toHaveBeenCalledWith({ path: { slug: 'ermou' } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved to your favourites.'),
    );
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
    expect(letGo).toHaveBeenCalledWith({ path: { slug: 'ermou' } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Removed from your favourites.'),
    );
    // The focus stays on the button throughout.
    expect(button).toHaveFocus();
  });

  it('says why it could not, beside the button, and stays as it was', async () => {
    keep.mockResolvedValue(refusal('FAVOURITES_LIMIT_REACHED') as never);
    renderInSubtree(<FavouriteButton slug="ermou" initial={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Favourite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saved the most places');
    expect(screen.getByRole('button', { name: 'Favourite', pressed: false })).toBeInTheDocument();
    keep.mockResolvedValue(refusal('SOMETHING_ELSE', 500) as never);
    await userEvent.click(screen.getByRole('button', { name: 'Favourite' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
  });

  it('ignores a second press while the first is being answered', async () => {
    let finish: (value: Result<typeof favouriteListing>) => void = () => {};
    keep.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    renderInSubtree(<FavouriteButton slug="ermou" initial={false} />);
    const button = screen.getByRole('button', { name: 'Favourite' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(keep).toHaveBeenCalledOnce();
    finish(answer({ favourite: true }) as Result<typeof favouriteListing>);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });

  it('speaks Greek', () => {
    renderInSubtree(<FavouriteButton slug="ermou" initial={false} />, { locale: 'el' });
    expect(screen.getByRole('button', { name: 'Αγαπημένο' })).toBeInTheDocument();
  });
});

describe('RemoveFavouriteButton', () => {
  const show = () =>
    renderInSubtree(
      <>
        <h2 id="name">Γκαράζ Ερμού</h2>
        <RemoveFavouriteButton slug="ermou" describedBy="name" />
      </>,
    );

  it('is described by the listing’s name, so two of them read apart', () => {
    show();
    expect(
      screen.getByRole('button', { name: 'Remove from favourites' }),
    ).toHaveAccessibleDescription('Γκαράζ Ερμού');
  });

  it('lets it go, and comes back to the page with a notice of its own, read again', async () => {
    letGo.mockResolvedValue(answer({ favourite: false }) as Result<typeof unfavouriteListing>);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove from favourites' }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledOnce());
    expect(letGo).toHaveBeenCalledWith({ path: { slug: 'ermou' } });
    expect(routerMock.replace).toHaveBeenCalledWith('/favourites?removed=ermou');
  });

  it('says when it could not, and leaves the page as it is', async () => {
    letGo.mockResolvedValue(refusal('SOMETHING_ELSE', 500) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove from favourites' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(routerMock.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove from favourites' })).toBeInTheDocument();
  });
});
