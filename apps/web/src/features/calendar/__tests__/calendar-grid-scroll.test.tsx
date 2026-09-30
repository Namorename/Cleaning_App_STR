import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { Property } from '@/features/tasks/schema';
import { buildPropertyTree, visibleRows } from '@/lib/property-tree';

import { CalendarGrid } from '../calendar-grid';

/**
 * Scrolling the grid redraws the grid itself — the virtualizer lives there —
 * but not the rows that were already on screen (ROADMAP, 7.6 tail: the long
 * tasks of a 30-day scroll were the rows being drawn again, not their number).
 */

// jsdom lays nothing out: the virtualizer is told the grid's size.
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({
        ...options,
        observeElementRect: (_instance, onChange) => {
          onChange({ width: 1200, height: 400 });
          return () => {};
        },
      }),
  };
});

// How many times each row's track was drawn.
const drawn = vi.hoisted(() => new Map<number, number>());
vi.mock('../row-track', () => ({
  RowTrack: ({ rowId }: { rowId: number }) => {
    drawn.set(rowId, (drawn.get(rowId) ?? 0) + 1);
    return null;
  },
}));

afterEach(() => drawn.clear());

const LISTINGS: Property[] = Array.from({ length: 60 }, (_, at) => ({
  id: 9100 + at,
  name: `Listing ${at + 1}`,
  parent_id: null,
  hostaway_unit_id: null,
  status: 'active',
  timezone: 'Europe/Prague',
}));

const DAYS = Array.from({ length: 30 }, (_, at) => {
  const day = new Date(Date.UTC(2026, 9, 1 + at));
  return day.toISOString().slice(0, 10);
});

const noop = () => {};

function renderGrid() {
  const collapsed = new Set<number>();
  return render(
    <CalendarGrid
      rows={visibleRows(buildPropertyTree(LISTINGS), collapsed)}
      all={LISTINGS}
      days={DAYS}
      depth={30}
      today="2026-10-01"
      locale="ru-RU"
      collapsed={collapsed}
      onToggleGroup={noop}
      layout={new Map()}
      byRowDay={new Map()}
      bookings={null}
      chipView="full"
      language="ru"
      onOpenBooking={noop}
      onOpenTask={noop}
      onMoreTasks={noop}
      onEmptyDay={noop}
      repairAlerts={new Map()}
      overscan={2}
    />,
  );
}

test('a scroll draws the rows that come into view, not again the ones already there', () => {
  // Arrange
  renderGrid();
  const before = new Map(drawn);
  expect(before.size).toBeGreaterThan(0);

  // Act: three rows down.
  const grid = screen.getByRole('grid');
  grid.scrollTop = 3 * 44;
  fireEvent.scroll(grid);

  // Assert: new rows were drawn, so the grid did redraw…
  expect([...drawn.keys()].some((id) => !before.has(id))).toBe(true);
  // …but every row still on screen kept its drawing.
  const stayed = [...before.keys()].filter(
    (id) =>
      screen.queryByRole('rowheader', {
        name: LISTINGS.find((one) => one.id === id)?.name,
      }) !== null,
  );
  expect(stayed.length).toBeGreaterThan(0);
  for (const id of stayed) {
    expect(drawn.get(id)).toBe(before.get(id));
  }
});
