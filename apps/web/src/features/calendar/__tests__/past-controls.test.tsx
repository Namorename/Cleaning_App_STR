import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { PastButton } from '../past-controls';
import type { CalendarPast } from '../use-past';

function past(overrides: Partial<CalendarPast> = {}): CalendarPast {
  return {
    days: [],
    isLoading: false,
    isError: false,
    error: null,
    isAtLimit: false,
    isAhead: false,
    shouldReveal: false,
    loadMore: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

// Final review of 2026-10-10: on a window moved past today there is no past
// next to it to show, so there is no button for it — the arrows go back.
test('offers no past on a window that starts after today', () => {
  const { container } = render(<PastButton past={past({ isAhead: true })} />);

  expect(container).toBeEmptyDOMElement();
});

test('offers it on a window that starts today or before', () => {
  render(<PastButton past={past()} />);

  expect(screen.getByRole('button')).toBeInTheDocument();
});
