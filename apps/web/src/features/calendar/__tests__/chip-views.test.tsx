import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { calendarTaskSchema, type CalendarTask } from '@/features/tasks/schema';

import type { ChipView } from '../chips';
import { TaskChips } from '../task-chips';

/**
 * The owner's report of 2026-10-12. A view means the same at every depth: a
 * plate with the status dot and words, never a bare dot. A compact chip is as
 * small as what it shows. A chip cut short at fifteen and thirty days still
 * names its person first, and «+N» keeps to its own cell.
 */

const ANNA = '11111111-1111-4111-8111-111111111111';
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];
/** The least width of a day at 3, 7, 15 and 30 days (`DAY_WIDTH`, dates.ts). */
const DEPTH_WIDTHS = [200, 130, 64, 32];

let serial = 0;
function task(day: string, extra: Record<string, unknown> = {}): CalendarTask {
  serial += 1;
  return calendarTaskSchema.parse({
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    property_id: 1,
    reservation_id: null,
    problem_id: null,
    type: 'cleaning',
    status: 'assigned',
    priority: 0,
    assignee_id: ANNA,
    scheduled_date: day,
    time_from: null,
    time_to: null,
    started_at: null,
    completed_at: null,
    measured_minutes: null,
    duration_override_min: null,
    notes: null,
    created_at: '2026-09-20T08:00:00+00:00',
    property: { name: 'Anglicka 7' },
    assignee: { full_name: 'Anna', role: 'cleaner' },
    problem: null,
    ...extra,
  });
}

function chips(tasks: CalendarTask[], dayWidth: number, view: ChipView) {
  return render(
    <TaskChips
      rowId={1}
      cells={DAYS.map((day) => tasks.filter((one) => one.scheduled_date === day))}
      days={DAYS}
      dayWidth={dayWidth}
      bookings={null}
      view={view}
      language="ru"
      onOpen={vi.fn()}
      onMore={vi.fn()}
    />,
  );
}

const annas = () => screen.getAllByRole('button', { name: /Anna/ });
const px = (value: string) => Number.parseFloat(value);

describe('a chip at every depth', () => {
  test.each(DEPTH_WIDTHS)('%i px: both views draw a plate with its dot and its person', (width) => {
    for (const view of ['full', 'compact'] as const) {
      const { unmount } = chips([task(DAYS[0])], width, view);

      const [chip] = annas();
      expect(chip.querySelector('[data-slot="chip-dot"]')).not.toBeNull();
      expect(chip).toHaveTextContent('Anna');
      unmount();
    }
  });
});

describe('a compact chip', () => {
  test('is as wide as what it shows, its slot the limit', () => {
    chips([task(DAYS[0])], 200, 'compact');

    const [chip] = annas();
    expect(chip.style.width).toBe('');
    expect(chip.style.maxWidth).toBe('194px');
  });

  test('is lower and tighter than a full one; a full one keeps its slot', () => {
    const compact = chips([task(DAYS[0])], 200, 'compact');
    const [small] = annas();
    expect(small.style.height).toBe('14px');
    expect(small).toHaveClass('px-0.5');
    compact.unmount();

    chips([task(DAYS[0])], 200, 'full');
    const [whole] = annas();
    expect(whole.style.width).toBe('194px');
    expect(whole.style.height).toBe('16px');
    expect(whole).toHaveClass('px-1');
  });
});

describe('a chip cut short', () => {
  const timed = () => task(DAYS[0], { time_from: '10:00:00', time_to: '15:00:00' });

  // Squeezed beside the name, the time and SDT showed as stray letters.
  test('in full, it reads its name; the time and SDT are in its tooltip', () => {
    chips([task(DAYS[0], { time_from: '10:00:00', time_to: '15:00:00', priority: 1 })], 64, 'full');

    const [chip] = annas();
    expect(chip).toHaveTextContent('Anna');
    expect(screen.queryByText('10:00–15:00')).toBeNull();
    expect(screen.queryByText('SDT')).toBeNull();
    expect(chip).toHaveAttribute('title', expect.stringContaining('10:00–15:00'));
    expect(chip).toHaveAttribute('title', expect.stringContaining('SDT'));
  });

  test('a week still keeps the time whole', () => {
    chips([timed()], 130, 'full');

    expect(screen.getByText('10:00–15:00')).toHaveClass('shrink-0');
  });

  // §6: an overdue repair reads without colour. Its dot was a framed square
  // when thirty days drew dots; cut short, its words may not show, so the
  // square stays. A week reads the words, and its dot stays round as it was.
  test('an overdue repair’s dot stays a framed square when its words are cut short', () => {
    const repair = () =>
      task(DAYS[0], {
        type: 'maintenance',
        problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        problem: { title: 'Течёт кран', priority: 'normal' },
      });
    const dot = () =>
      screen.getByRole('link', { name: /Течёт кран/ }).querySelector('[data-slot="chip-dot"]');

    const narrow = chips([repair()], 32, 'full');
    expect(dot()).toHaveClass('rounded-sm', 'border-2', 'border-tone-overdue-mark');
    narrow.unmount();

    chips([repair()], 130, 'full');
    expect(dot()).toHaveClass('rounded-full');
  });

  test.each(['full', 'compact'] as const)(
    'at thirty days a %s chip and «+N» share their cell and stay in it',
    (view) => {
      const dayWidth = 32;
      chips([task(DAYS[1]), task(DAYS[1]), task(DAYS[1])], dayWidth, view);

      const cellLeft = dayWidth;
      const more = screen.getByRole('button', { name: '+2' });
      const moreLeft = px(more.style.left);
      expect(moreLeft + px(more.style.width)).toBeLessThanOrEqual(cellLeft + dayWidth);

      const [chip] = annas();
      const chipLeft = px(chip.style.left);
      const chipWidth = px(chip.style.width || chip.style.maxWidth);
      expect(chipLeft).toBeGreaterThanOrEqual(cellLeft);
      expect(chipWidth).toBeGreaterThan(0);
      expect(chipLeft + chipWidth).toBeLessThanOrEqual(moreLeft);
    },
  );
});
