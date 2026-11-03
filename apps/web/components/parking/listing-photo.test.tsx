import type { ListingPhoto } from '@parkfairy/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListingPhotoImage } from './listing-photo';

const photo: ListingPhoto = {
  key: 'a'.repeat(32),
  width: 1600,
  height: 1067,
  alt: null,
  color: '#334455',
};

describe('ListingPhotoImage', () => {
  it('offers each stored size and lets the browser choose', () => {
    render(<ListingPhotoImage photo={photo} alt="Η είσοδος" sizes="100vw" />);
    const image = screen.getByRole('img', { name: 'Η είσοδος' });
    expect(image.getAttribute('srcset')).toContain('/480.webp 480w');
    expect(image.getAttribute('srcset')).toContain('/1600.webp 1600w');
    expect(image).toHaveAttribute('sizes', '100vw');
  });

  it('holds its place while loading, so nothing moves', () => {
    render(<ListingPhotoImage photo={photo} alt="x" sizes="100vw" />);
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('width', '1600');
    expect(image).toHaveAttribute('height', '1067');
    expect(image).toHaveStyle({ backgroundColor: '#334455' });
  });

  it('loads lazily unless it is the first thing on the page', () => {
    const { unmount } = render(<ListingPhotoImage photo={photo} alt="x" sizes="100vw" />);
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
    unmount();
    render(<ListingPhotoImage photo={photo} alt="x" sizes="100vw" priority />);
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'eager');
    expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('marks the text with the language it is written in', () => {
    render(<ListingPhotoImage photo={photo} alt="Η είσοδος" lang="el" sizes="100vw" />);
    expect(screen.getByRole('img')).toHaveAttribute('lang', 'el');
  });
});
