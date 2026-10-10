import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

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

interface GridOptions {
  revealPast?: boolean;
}

function grid(days: readonly string[], onReachStart: () => void, options: GridOptions = {}) {
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
      revealPast={options.revealPast}
    />
  );
}

/** jsdom lays nothing out: the grid is given how wide its days are and how wide it is. */
function setLayout(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
}

/** The grid, its days wider than it unless a test says otherwise; `show` keeps the same handler. */
function renderGrid(days: readonly string[] = WEEK, options: GridOptions = {}) {
  const onReachStart = vi.fn();
  const view = render(grid(days, onReachStart, options));
  const scroller = screen.getByRole('grid');
  setLayout(scroller, 5000, 1000);
  const show = (next: readonly string[], nextOptions: GridOptions = {}) =>
    view.rerender(grid(next, onReachStart, nextOptions));
  return { onReachStart, scroller, show };
}

afterEach(() => {
  vi.useRealTimers();
});

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

  // A trackpad's swipe past the start would otherwise go back a page in the
  // browser instead of asking for the past.
  test('a swipe past the start stays in the grid, not the browser’s history', () => {
    const { scroller } = renderGrid();

    expect(scroller).toHaveClass('overscroll-x-contain');
  });

  test('the wheel to the left away from the start only scrolls', () => {
    const { scroller, onReachStart } = renderGrid();
    scroller.scrollLeft = 300;
    fireEvent.scroll(scroller);

    fireEvent.wheel(scroller, { deltaX: -60 });

    expect(onReachStart).not.toHaveBeenCalled();
  });
});

// Review of 2026-10-10 (HIGH): a scroll the grid did not get from the manager
// — the past dropped, the window resized — is not the manager at the start.
describe('a scroll the manager did not make asks nothing', () => {
  test('the past dropped — «Сегодня», an arrow, a depth — bringing the scroll to the start', () => {
    const { scroller, onReachStart, show } = renderGrid([...PAST, ...WEEK]);
    scroller.scrollLeft = PAST.length * DAY;
    fireEvent.scroll(scroller);

    show(WEEK);
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);

    expect(onReachStart).not.toHaveBeenCalled();
  });

  test('a wider window in which the days fit, which puts the scroll at the start', () => {
    const { scroller, onReachStart } = renderGrid();
    scroller.scrollLeft = 300;
    fireEvent.scroll(scroller);

    setLayout(scroller, 1000, 1000);
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);

    expect(onReachStart).not.toHaveBeenCalled();
  });

  // A trackpad's fling runs on after a chunk lands: one fling, one chunk.
  test('just after a chunk lands the edge waits a moment, then asks again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    const { scroller, onReachStart, show } = renderGrid();

    show([...PAST, ...WEEK]);
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    fireEvent.wheel(scroller, { deltaX: -60 });
    expect(onReachStart).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-10-10T10:00:01Z'));
    fireEvent.wheel(scroller, { deltaX: -60 });
    expect(onReachStart).toHaveBeenCalledTimes(1);
  });
});

describe('the days on screen stay where they were', () => {
  test('when days are put before the window', () => {
    const { scroller, show } = renderGrid();
    scroller.scrollLeft = 50;

    show([...PAST, ...WEEK]);

    expect(scroller.scrollLeft).toBe(50 + PAST.length * DAY);
    expect(
      screen
        .getAllByRole('columnheader')
        .slice(1)
        .map((cell) => cell.getAttribute('data-day')),
    ).toEqual([...PAST, ...WEEK]);
  });

  test('when the past before the window is dropped', () => {
    const { scroller, show } = renderGrid([...PAST, ...WEEK]);
    scroller.scrollLeft = 50 + PAST.length * DAY;

    show(WEEK);

    expect(scroller.scrollLeft).toBe(50);
  });

  test('the putting of days before the window is no scroll to the start', () => {
    const { scroller, show, onReachStart } = renderGrid();
    scroller.scrollLeft = 0;

    show([...PAST, ...WEEK]);
    fireEvent.scroll(scroller);

    expect(onReachStart).not.toHaveBeenCalled();
  });

  test('an arrow — another window — leaves the scroll as it was', () => {
    const { scroller, show } = renderGrid();
    scroller.scrollLeft = 50;

    show(windowDays('2026-10-02', 7));

    expect(scroller.scrollLeft).toBe(50);
  });

  // Review of 2026-10-10: a press of «Показать прошлое» where the whole window
  // fits would put the chunk out of sight; asked by a press, it is shown.
  test('except a chunk asked for by a press, which is brought into view', () => {
    const { scroller, show } = renderGrid();
    scroller.scrollLeft = 50;

    show([...PAST, ...WEEK], { revealPast: true });

    expect(scroller.scrollLeft).toBe(0);
  });
});
