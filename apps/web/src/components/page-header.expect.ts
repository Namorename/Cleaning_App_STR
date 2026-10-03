import { screen } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * For the pages' tests: the page is headed by the common header
 * (`page-header.tsx`), and its one h1 reads `title`.
 */
export function expectPageTitle(title: string): void {
  const headings = screen.getAllByRole('heading', { level: 1 });

  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveAccessibleName(title);
  expect(headings[0].closest('[data-slot="page-header"]')).not.toBeNull();
}
