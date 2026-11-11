import type { ReactNode } from 'react';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonName, PlaceName, placeTag, PlaceWords } from './place-words';

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
  it('gives t.rich a tag that renders the words whatever the chunks hold', async () => {
    const tag = placeTag('Garage by Σύνταγμα', 'en') as (chunks: ReactNode) => ReactNode;
    expect(html(tag(['other words']))).toBe(
      '<p><span lang="en">Garage by <span lang="el">Σύνταγμα</span></span></p>',
    );
    const { container } = render(
      <main>
        <p>{tag(['other words'])}</p>
      </main>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('PersonName', () => {
  it('isolates a name, and marks its Greek letters on an English page only', () => {
    expect(html(<PersonName name="Νίκη Πολλών" lang="en" className="wrap-anywhere" />)).toBe(
      '<p><bdi class="wrap-anywhere"><span lang="el">Νίκη Πολλών</span></bdi></p>',
    );
    expect(html(<PersonName name="Νίκη Πολλών" lang="el" />)).toBe('<p><bdi>Νίκη Πολλών</bdi></p>');
    // A right-to-left name is isolated and left as it is.
    expect(html(<PersonName name="نور Smith" lang="en" />)).toBe('<p><bdi>نور Smith</bdi></p>');
  });
});
