import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { Property } from '@/features/tasks/schema';
import { buildPropertyTree, visibleRows } from '@/lib/property-tree';

import { CalendarGrid } from '../calendar-grid';
import { DAY_WIDTH, pastChunk, windowDays } from '../dates';

/**
 * The past on demand at the grid (the owner's word of 2026-10-10, block 7):
 * it is asked for at the left edge — a scroll or the scrollbar landing on
 * the start, a wheel or Shift and the wheel pushing past it — and days put
 * before the window leave the days on screen where they were.
 */

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
vi.mock('../row-track', () => ({ RowTrack: () => null }));

const LISTINGS: Property[] = Array.from({ length: 5 }, (_, at) => ({
  id: 9100 + at,
  name: `Listing ${at + 1}`,
  parent_id: null,
  hostaway_unit_id: null,
  status: 'active',
  timezone: 'Europe/Prague',
}));

const TODAY = '2026-10-10';
const WEEK = windowDays('2026-10-09', 7);
const PAST = pastChunk('2026-10-09', TODAY);
// Nothing measures in jsdom: a day is the least width of its depth.
const DAY = DAY_WIDTH[7];

const noop = () => {};

function grid(days: readonly string[], onReachStart = vi.fn()) {
  const collapsed = new Set<number>();
  return (
    <CalendarGrid
      rows={visibleRows(buildPropertyTree(LISTINGS), collapsed)}
      all={LISTINGS}
      days={days}
      depth={7}
      today={TODAY}
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
      onReachStart={onReachStart}
    />
  );
}

function renderGrid(days: readonly string[] = WEEK) {
  const onReachStart = vi.fn();
  const view = render(grid(days, onReachStart));
  return { ...view, onReachStart, scroller: screen.getByRole('grid') };
}

describe('the left edge asks for the past', () => {
  test('a scroll — the scrollbar or the keys — that lands on the start', () => {
    const { scroller, onReachStart } = renderGrid();

    scroller.scrollLeft = 300;
    fireEvent.scroll(scroller);
    expect(onReachStart).not.toHaveBeenCalled();

    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(onReachStart).toHaveBeenCalledTimes(1);
  });

  test('a scroll up or down at the start asks nothing', () => {
    const { scroller, onReachStart } = renderGrid();

    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    expect(onReachStart).not.toHaveBeenCalled();
  });

  test('the wheel pushed to the left at the start', () => {
    const { scroller, onReachStart } = renderGrid();

    fireEvent.wheel(scroller, { deltaX: -60, deltaY: 4 });

    expect(onReachStart).toHaveBeenCalledTimes(1);
  });

  test('Shift and the wheel turned up at the start', () => {
    const { scroller, onReachStart } = renderGrid();

    fireEvent.wheel(scroller, { deltaY: -100, shiftKey: true });

    expect(onReachStart).toHaveBeenCalledTimes(1);
  });

  test('the wheel down, to the right, or mostly down asks nothing', () => {
    const { scroller, onReachStart } = renderGrid();

    fireEvent.wheel(scroller, { deltaY: 100 });
    fireEvent.wheel(scroller, { deltaX: 60 });
    fireEvent.wheel(scroller, { deltaY: 100, shiftKey: true });
    // A trackpad's swipe down drifts a little sideways.
    fireEvent.wheel(scroller, { deltaX: -3, deltaY: 80 });

    expect(onReachStart).not.toHaveBeenCalled();
  });

  test('the wheel to the left away from the start only scrolls', () => {
    const { scroller, onReachStart } = renderGrid();
    scroller.scrollLeft = 300;
    fireEvent.scroll(scroller);

    fireEvent.wheel(scroller, { deltaX: -60 });

    expect(onReachStart).not.toHaveBeenCalled();
  });
});

describe('the days on screen stay where they were', () => {
  test('when days are put before the window', () => {
    const { scroller, rerender } = renderGrid();
    scroller.scrollLeft = 50;

    rerender(grid([...PAST, ...WEEK]));

    expect(scroller.scrollLeft).toBe(50 + PAST.length * DAY);
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(1)
        .map((cell) => cell.getAttribute('data-day')),
    ).toEqual([...PAST, ...WEEK]);
  });

  test('when the past before the window is dropped', () => {
    const { scroller, rerender } = renderGrid([...PAST, ...WEEK]);
    scroller.scrollLeft = 50 + PAST.length * DAY;

    rerender(grid(WEEK));

    expect(scroller.scrollLeft).toBe(50);
  });

  test('the putting of days before the window is no scroll to the start', () => {
    const { scroller, rerender, onReachStart } = renderGrid();
    scroller.scrollLeft = 0;

    rerender(grid([...PAST, ...WEEK]));
    fireEvent.scroll(scroller);

    expect(onReachStart).not.toHaveBeenCalled();
  });

  test('an arrow — another window — leaves the scroll as it was', () => {
    const { scroller, rerender } = renderGrid();
    scroller.scrollLeft = 50;

    rerender(grid(windowDays('2026-10-02', 7)));

    expect(scroller.scrollLeft).toBe(50);
  });
});
