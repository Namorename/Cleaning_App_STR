import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { BoardColumnFrame } from './board-column';
import { BOARD_PAGE_CLASS, BOARD_STAGE_CLASS, BoardViewport } from './board-viewport';
import { EDGE_MAX_STEP, EDGE_ZONE, edgeScroller, edgeStep } from './use-edge-scroll';

/** A box `size` px tall at the top of the window that scrolls `room` px at most, as a browser clamps it. */
function scrollingBox(element: HTMLElement, size: number, room: number) {
  let top = 0;
  let left = 0;
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(room, value));
    },
  });
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = Math.max(0, Math.min(room, value));
    },
  });
  element.getBoundingClientRect = () =>
    ({ top: 0, bottom: size, left: 0, right: size, width: size, height: size }) as DOMRect;
  return element;
}

/** Frames run by hand, on a clock the test moves. */
function manualFrames() {
  let clock = 0;
  let queue: Array<() => void> = [];
  return {
    frames: {
      request: (run: () => void) => {
        queue.push(run);
        return queue.length;
      },
      cancel: () => {
        queue = [];
      },
      now: () => clock,
    },
    /** One frame, `ms` after the last. */
    run(ms = 16) {
      clock += ms;
      const due = queue;
      queue = [];
      for (const run of due) {
        run();
      }
    },
    get pending() {
      return queue.length;
    },
  };
}

describe('edgeStep', () => {
  test('scrolls nothing in the middle of the box', () => {
    expect(edgeStep(300, 0, 600)).toBe(0);
  });

  test('scrolls back near the start and on near the end, faster the nearer the side', () => {
    const near = edgeStep(600 - EDGE_ZONE / 2, 0, 600);
    const nearer = edgeStep(600 - 4, 0, 600);
    expect(near).toBeGreaterThan(0);
    expect(nearer).toBeGreaterThan(near);
    expect(edgeStep(4, 0, 600)).toBe(-nearer);
  });

  test('scrolls the most with the pointer at the side or past it: over the head or the footer', () => {
    expect(edgeStep(600, 0, 600)).toBe(EDGE_MAX_STEP);
    expect(edgeStep(700, 0, 600)).toBe(EDGE_MAX_STEP);
    expect(edgeStep(-40, 0, 600)).toBe(-EDGE_MAX_STEP);
  });

  test('a short box keeps a still middle third, and an empty one never scrolls', () => {
    expect(edgeStep(60, 0, 120)).toBe(0);
    expect(edgeStep(110, 0, 120)).toBeGreaterThan(0);
    expect(edgeStep(0, 0, 0)).toBe(0);
  });
});

describe('edgeScroller', () => {
  test('scrolls a frame at a time while the item is held near the bottom', () => {
    const box = scrollingBox(document.createElement('div'), 600, 1000);
    const clock = manualFrames();
    const scroller = edgeScroller('y', () => box, clock.frames);

    scroller.over({ clientX: 10, clientY: 598 });
    clock.run();
    clock.run();

    expect(box.scrollTop).toBe(2 * EDGE_MAX_STEP);
  });

  test('stops at the end of the box, and when the pointer moves to the middle', () => {
    const box = scrollingBox(document.createElement('div'), 600, 20);
    const clock = manualFrames();
    const scroller = edgeScroller('y', () => box, clock.frames);

    scroller.over({ clientX: 10, clientY: 598 });
    clock.run();
    clock.run();
    clock.run();
    expect(box.scrollTop).toBe(20);
    expect(clock.pending).toBe(0);

    scroller.over({ clientX: 10, clientY: 2 });
    clock.run();
    scroller.over({ clientX: 10, clientY: 300 });
    clock.run();
    clock.run();
    expect(box.scrollTop).toBe(20 - EDGE_MAX_STEP);
  });

  test('scrolls sideways along x', () => {
    const box = scrollingBox(document.createElement('div'), 600, 1000);
    const clock = manualFrames();
    const scroller = edgeScroller('x', () => box, clock.frames);

    scroller.over({ clientX: 599, clientY: 300 });
    clock.run();

    expect(box.scrollLeft).toBe(EDGE_MAX_STEP);
    expect(box.scrollTop).toBe(0);
  });

  test('stops when the pointer leaves, but not when it moves onto a child', () => {
    const column = document.createElement('section');
    const child = column.appendChild(document.createElement('article'));
    const box = scrollingBox(document.createElement('div'), 600, 1000);
    const clock = manualFrames();
    const scroller = edgeScroller('y', () => box, clock.frames);

    scroller.over({ clientX: 10, clientY: 598 });
    scroller.leave({ currentTarget: column, relatedTarget: child });
    clock.run();
    expect(box.scrollTop).toBe(EDGE_MAX_STEP);

    scroller.leave({ currentTarget: column, relatedTarget: document.body });
    clock.run();
    expect(box.scrollTop).toBe(EDGE_MAX_STEP);
  });

  test('stops by itself when no dragover has come for a while: the pointer is gone', () => {
    const box = scrollingBox(document.createElement('div'), 600, 1000);
    const clock = manualFrames();
    const scroller = edgeScroller('y', () => box, clock.frames);

    scroller.over({ clientX: 10, clientY: 598 });
    clock.run(800);

    expect(box.scrollTop).toBe(0);
    expect(clock.pending).toBe(0);
  });
});

describe('BoardColumnFrame', () => {
  const frame = (props: Partial<Parameters<typeof BoardColumnFrame>[0]> = {}) =>
    render(
      <BoardColumnFrame
        label="Открыто"
        heading={<span>Открыто</span>}
        markClassName="bg-tone-neutral-mark"
        count={2}
        emptyText="Пусто"
        footer={<button type="button">Быстрая карточка</button>}
        {...props}
      >
        <article aria-label="Первая">Первая</article>
        <article aria-label="Вторая">Вторая</article>
      </BoardColumnFrame>,
    );

  test('scrolls its items on its own; the head with the count and the footer stay in sight', () => {
    frame();

    const column = screen.getByRole('region', { name: 'Открыто' });
    const items = column.querySelector('[data-slot="board-column-items"]');
    expect(items).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden');
    expect(within(items as HTMLElement).getAllByRole('article')).toHaveLength(2);
    const head = within(column).getByText('2').closest('header');
    expect(items?.contains(head)).toBe(false);
    expect(head).toHaveClass('shrink-0');
    expect(items?.contains(screen.getByRole('button', { name: 'Быстрая карточка' }))).toBe(false);
  });

  test('says there is nothing inside the scrolling box', () => {
    frame({ count: 0, children: undefined });

    const items = screen
      .getByRole('region', { name: 'Открыто' })
      .querySelector('[data-slot="board-column-items"]');
    expect(within(items as HTMLElement).getByText('Пусто')).toBeInTheDocument();
  });

  test('a dragged card held near the bottom scrolls the column, and the drop still lands', () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'],
    });
    const onDragOver = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onDrop = vi.fn();
    frame({
      drop: { onDragEnter: vi.fn(), onDragOver, onDragLeave: vi.fn(), onDrop },
      isDroppable: true,
    });
    const column = screen.getByRole('region', { name: 'Открыто' });
    const items = scrollingBox(
      column.querySelector<HTMLElement>('[data-slot="board-column-items"]') as HTMLElement,
      600,
      1000,
    );

    // jsdom has no DragEvent: a mouse event of the type carries the pointer, as a browser's does.
    act(() => {
      items.dispatchEvent(
        new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 10, clientY: 598 }),
      );
    });
    vi.advanceTimersByTime(50);

    expect(items.scrollTop).toBeGreaterThan(0);
    expect(onDragOver).toHaveBeenCalled();
    const scrolled = items.scrollTop;
    fireEvent.drop(column);
    vi.advanceTimersByTime(50);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(items.scrollTop).toBe(scrolled);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe('BoardViewport', () => {
  test('marks the board the page fills the window for, and lays the columns out in its grid', () => {
    const { container } = render(
      <BoardViewport slot="manager-board" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <section aria-label="A" />
        <section aria-label="B" />
      </BoardViewport>,
    );

    const grid = container.querySelector('[data-slot="manager-board"]') as HTMLElement;
    const frame = grid.parentElement as HTMLElement;
    expect(frame).toHaveAttribute('data-board-fill');
    expect(frame).toHaveClass('overflow-x-auto', 'min-h-0', 'flex-1');
    expect(grid).toHaveClass('grid', 'md:min-h-0', 'md:items-stretch', 'items-start');
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });

  test('the page is the window less the shell only while a board shows, and only from md up', () => {
    expect(BOARD_PAGE_CLASS).toContain(
      'md:has-[[data-board-fill]]:h-[calc(100dvh_-_var(--page-chrome,3rem))]',
    );
    expect(BOARD_PAGE_CLASS).not.toMatch(/(^|\s)h-/);
    expect(BOARD_STAGE_CLASS).toContain('min-h-0');
    expect(BOARD_STAGE_CLASS).toContain('md:group-has-[[data-board-fill]]/board-page:min-h-64');
  });
});
