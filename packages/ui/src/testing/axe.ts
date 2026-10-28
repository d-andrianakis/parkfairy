import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Asserts a rendered component has no WCAG 2.2 A/AA violations. jsdom cannot compute
 * colours, so contrast is checked by the Playwright smoke suite in a real browser.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  const findings = results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(findings).toEqual([]);
}
