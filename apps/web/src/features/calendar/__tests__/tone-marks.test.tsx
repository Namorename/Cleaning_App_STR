import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { calendarTaskSchema, type CalendarTask } from '@/features/tasks/schema';

import type { Bar } from '../bars';
import { RowTrack } from '../row-track';
import type { CalendarBooking } from '../schema';
import { TaskChips } from '../task-chips';

// The test DOM (jsdom 20) drops a gradient that holds var(), which every browser
// keeps: the stripes are checked on hatchImage itself (tone-classes.test.ts),
// and here only which hatch each mark asks for.
vi.mock('@/lib/design/hatch', () => ({
  hatchImage: (tone: string) => `url("hatch-${tone}")`,
}));

/**
 * The calendar's colours come from the tone contract (5.2, plan §8 p.1):
 * every status by its tone (`STATUS_TONE`), the two hatches by their angle
 * (`HATCH_ANGLE`: 45° «Не состоялась», 135° «Блок»). Shapes, sizes and the
 * layout stay as they are until 5.4.
 */

const ANNA = '11111111-1111-4111-8111-111111111111';
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
/** Thirty days: a cell this narrow shows dots. */
const DOT_WIDTH = 30;
/** A week: a cell this wide shows a chip in full. */
const FULL_WIDTH = 140;

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

function chips(tasks: CalendarTask[], dayWidth: number, view: 'full' | 'compact' = 'full') {
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

describe('the marks of the chips', () => {
  test('a dot takes the mark of its status’s tone', () => {
    chips(
      [
        task(DAYS[0], { status: 'unassigned', assignee_id: null, assignee: null }),
        task(DAYS[1], { status: 'assigned' }),
        task(DAYS[2], { status: 'in_progress' }),
        task(DAYS[3], { status: 'done' }),
        task(DAYS[4], { status: 'blocked' }),
      ],
      DOT_WIDTH,
    );

    expect(screen.getByRole('button', { name: /Без исполнителя/ })).toHaveClass(
      'bg-tone-unassigned-mark',
    );
    expect(screen.getByRole('button', { name: /Назначена/ })).toHaveClass('bg-tone-assigned-mark');
    expect(screen.getByRole('button', { name: /В работе/ })).toHaveClass(
      'bg-tone-in-progress-mark',
    );
    expect(screen.getByRole('button', { name: /Выполнена/ })).toHaveClass('bg-tone-done-mark');
    expect(screen.getByRole('button', { name: /Заблокирована/ })).toHaveClass(
      'bg-tone-urgent-mark',
    );
  });

  test('what never happened is a hollow ring of its tone, the cancelled a pale square', () => {
    chips(
      [task(DAYS[0], { status: 'expired' }), task(DAYS[1], { status: 'cancelled' })],
      DOT_WIDTH,
    );

    const lapsed = screen.getByRole('button', { name: /Не состоялась/ });
    expect(lapsed).toHaveClass('rounded-full', 'border-2', 'border-tone-not-happened-mark');
    expect(screen.getByRole('button', { name: /Отменена/ })).toHaveClass(
      'rounded-none',
      'bg-tone-cancelled-mark',
    );
  });

  test('the chip of what never happened is hatched in its own tone (45°, HATCH_ANGLE)', () => {
    chips([task(DAYS[0], { status: 'expired' })], FULL_WIDTH);

    const chip = screen.getByRole('button', { name: /Не состоялась/ });
    expect(chip).toHaveClass('bg-tone-not-happened-bg', 'text-tone-not-happened-fg');
    expect(chip.style.backgroundImage).toContain('hatch-notHappened');
  });

  test('SDT is marked in the urgent tone', () => {
    chips([task(DAYS[0], { priority: 1 })], FULL_WIDTH);

    expect(screen.getByText('SDT')).toHaveClass('bg-tone-urgent-bg', 'text-tone-urgent-fg');
  });

  test('a chip nobody holds names nobody in the unassigned tone, not in red', () => {
    chips(
      [task(DAYS[0], { status: 'unassigned', assignee_id: null, assignee: null })],
      FULL_WIDTH,
      'compact',
    );

    const nobody = screen.getByText('Никто');
    expect(nobody).toHaveClass('text-tone-unassigned-fg');
    expect(nobody).not.toHaveClass('text-destructive');
  });
});

const BLOCK: CalendarBooking = {
  id: 7,
  property_id: 1,
  arrival_date: DAYS[0],
  departure_date: DAYS[2],
  status: 'new',
  is_block: true,
  guest_name: null,
  guests_count: null,
  check_in_time: null,
  check_out_time: null,
  rooms: [],
  is_service_booking: false,
};

function bar(booking: CalendarBooking, kind: Bar['kind'], lanes = 1): Bar {
  return { booking, kind, from: 0, to: 2, cutStart: false, cutEnd: false, lane: 0, lanes };
}

function track(bars: Bar[]) {
  return render(
    <RowTrack
      rowId={1}
      layout={{ bars, shadows: [], occupancy: [] }}
      cells={DAYS.map(() => [])}
      bookings={null}
      days={DAYS}
      dayWidth={FULL_WIDTH}
      dayLines=""
      isClosedGroup={false}
      unitCount={0}
      highlighted={null}
      chipView="full"
      language="ru"
      onPoint={vi.fn()}
      onOpen={vi.fn()}
      onOpenTask={vi.fn()}
      onMoreTasks={vi.fn()}
      onEmptyDay={vi.fn()}
    />,
  );
}

describe('the bars', () => {
  test('a guest’s stay is a bar of the booking tone', () => {
    track([bar({ ...BLOCK, is_block: false, guest_name: 'Jana' }, 'guest')]);

    expect(screen.getByRole('button', { name: /Jana/ })).toHaveClass(
      'bg-tone-booking-mark',
      'text-tone-booking-on-mark',
    );
  });

  test('a block is hatched in its own tone (135°, HATCH_ANGLE)', () => {
    track([bar(BLOCK, 'block')]);

    const block = screen.getByRole('button', { name: /Блок/ });
    expect(block).toHaveClass(
      'bg-tone-block-mark',
      'text-tone-block-fg',
      'border-tone-block-border',
    );
    expect(block.style.backgroundImage).toContain('hatch-block');
  });

  test('a double booking is ringed in the urgent tone', () => {
    track([bar({ ...BLOCK, is_block: false, guest_name: 'Jana' }, 'guest', 2)]);

    expect(screen.getByRole('button', { name: /Jana/ })).toHaveClass('ring-tone-urgent-mark');
  });
});
