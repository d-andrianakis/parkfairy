import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaceName, placeTag, PlaceWords } from './place-words';

const html = (node: ReactNode) => render(<p>{node}</p>).container.innerHTML;

describe('PlaceWords', () => {
  it('marks the Greek runs inside English, and leaves the rest as text', () => {
    expect(html(<PlaceWords text="Lot on Οδός Ερμού 5, Athens" lang="en" />)).toBe(
      '<p>Lot on <span lang="el">Οδός Ερμού</span> 5, Athens</p>',
    );
  });

  it('marks nothing on a Greek page', () => {
    expect(html(<PlaceWords text="Γκαράζ Central" lang="el" />)).toBe('<p>Γκαράζ Central</p>');
  });
});

describe('PlaceName', () => {
  it('sets the words in the language they were written in, their Greek marked inside', () => {
    expect(html(<PlaceName text="Garage by Σύνταγμα" lang="en" />)).toBe(
      '<p><span lang="en">Garage by <span lang="el">Σύνταγμα</span></span></p>',
    );
    expect(html(<PlaceName text="Γκαράζ Ερμού" lang="el" />)).toBe(
      '<p><span lang="el">Γκαράζ Ερμού</span></p>',
    );
  });

  it('leaves words of ours in the page’s language, unmarked', () => {
    expect(html(<PlaceName text="Unnamed listing" lang={undefined} />)).toBe(
      '<p>Unnamed listing</p>',
    );
  });
});

describe('placeTag', () => {
  it('gives t.rich a tag that renders the words whatever the chunks hold', () => {
    const tag = placeTag('Garage by Σύνταγμα', 'en');
    expect(html(tag())).toBe(
      '<p><span lang="en">Garage by <span lang="el">Σύνταγμα</span></span></p>',
    );
  });
});
