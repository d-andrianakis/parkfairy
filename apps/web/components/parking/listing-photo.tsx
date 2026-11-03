import { PHOTO_WIDTHS, photoUrl, type ListingPhoto } from '@parkfairy/contracts';

interface ListingPhotoImageProps {
  photo: ListingPhoto;
  /** Empty where the text beside it already says everything (WCAG 1.1.1). */
  alt: string;
  lang?: string | undefined;
  /** What the layout gives it, for choosing a file. */
  sizes: string;
  className?: string;
  /** The first thing on a page: it shouldn't wait for the rest. */
  priority?: boolean;
}

/**
 * A stored photo at the size a screen needs. Not next/image: the files are already resized and
 * immutable, and its optimiser would pay to do that work again. Its colour shows while it loads,
 * and the width and height hold its place, so nothing moves.
 */
export function ListingPhotoImage({
  photo,
  alt,
  lang,
  sizes,
  className,
  priority = false,
}: ListingPhotoImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above
    <img
      src={photoUrl(photo.key, 960)}
      srcSet={PHOTO_WIDTHS.map((width) => `${photoUrl(photo.key, width)} ${width}w`).join(', ')}
      sizes={sizes}
      alt={alt}
      lang={lang}
      width={photo.width}
      height={photo.height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={className}
      style={{ backgroundColor: photo.color }}
    />
  );
}
