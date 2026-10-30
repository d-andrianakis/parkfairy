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
