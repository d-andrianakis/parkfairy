import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FocusHeading } from './focus-heading';

describe('FocusHeading', () => {
  beforeEach(() => {
    document.title = 'Create account · Parkfairy';
  });

  it('takes the focus when it appears', () => {
    render(<FocusHeading>Check your inbox</FocusHeading>);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    // The focus reads it out; the status would say it twice.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('takes it from the main region, where a route change leaves it', () => {
    render(
      <main id="main-content" tabIndex={-1} data-testid="main">
        <button type="button">Back</button>
      </main>,
    );
    screen.getByTestId('main').focus();

    render(<FocusHeading>Check your inbox</FocusHeading>);

    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('takes it when the form that held it goes', () => {
    const { rerender } = render(<input aria-label="Email" />);
    screen.getByRole('textbox').focus();

    rerender(<FocusHeading>Check your inbox</FocusHeading>);

    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('leaves someone who has moved on where they are, tells them, and renames the tab', () => {
    render(<button type="button">Help</button>);
    screen.getByRole('button').focus();

    render(<FocusHeading retitle>Check your inbox</FocusHeading>);

    expect(screen.getByRole('button')).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Check your inbox');
    expect(document.title).toBe('Check your inbox · Parkfairy');
  });

  it('leaves someone inside the main region where they are, too', () => {
    render(
      <main id="main-content" tabIndex={-1}>
        <button type="button">Back</button>
      </main>,
    );
    screen.getByRole('button').focus();

    render(<FocusHeading>Check your inbox</FocusHeading>);

    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('can be a lower heading, and leaves the tab title alone by default', () => {
    render(<FocusHeading level="h3">Save your backup codes</FocusHeading>);
    expect(screen.getByRole('heading', { level: 3 })).toHaveFocus();
    expect(document.title).toBe('Create account · Parkfairy');
  });

  it('renames the tab when it replaces what the title described', () => {
    render(<FocusHeading retitle>Check your inbox</FocusHeading>);
    expect(document.title).toBe('Check your inbox · Parkfairy');
  });

  it('shows the focus to keyboard users, forced colours included', () => {
    render(<FocusHeading>Check your inbox</FocusHeading>);
    // outline-hidden keeps a transparent outline, which forced-colors mode paints.
    expect(screen.getByRole('heading').className).toMatch(/outline-hidden/);
    expect(screen.getByRole('heading').className).toMatch(/focus-visible:ring/);
  });
});
