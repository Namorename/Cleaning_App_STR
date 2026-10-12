import { ICONS } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { UnreadSubjects } from '@/features/chat/schema';
import { calendarTaskSchema, type CalendarTask } from '@/features/tasks/schema';

import { CellTasksDialog } from '../cell-tasks-dialog';
import type { ChipView } from '../chips';
import { TaskChips } from '../task-chips';

/**
 * 5.4, «Чат»: a job somebody wrote about carries «Новое сообщение» in the
 * calendar too. A chip is small, so the mark is a picture beside its dot, at
 * every depth; the words are in its name and its tooltip.
 */

const ANNA = '11111111-1111-4111-8111-111111111111';
const PROBLEM = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];
/** Thirty days: a cell this narrow cuts a chip short. */
const NARROW_WIDTH = 30;
/** Fifteen days: cut short in full, yet room for the picture. */
const FIFTEEN_DAYS_WIDTH = 64;
/** A week: a cell this wide shows a chip in full. */
const FULL_WIDTH = 140;
const WORDS = 'Новое сообщение';
const GLYPH = `lucide-${ICONS['action.openChat']}`;

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

const written = task(DAYS[0]);
const quiet = task(DAYS[1], { assignee: { full_name: 'Iva', role: 'cleaner' } });
const repair = task(DAYS[2], {
  type: 'maintenance',
  problem_id: PROBLEM,
  problem: { title: 'Течёт кран', priority: 'normal' },
  assignee: { full_name: 'Petr', role: 'tech' },
});

/** A cleaning's thread is its own; a repair speaks in its problem's (open_thread). */
const unread: UnreadSubjects = { tasks: new Set([written.id]), problems: new Set([PROBLEM]) };

function chips(dayWidth: number, view: ChipView = 'full') {
  const tasks = [written, quiet, repair];
  return render(
    <TaskChips
      rowId={1}
      cells={DAYS.map((day) => tasks.filter((one) => one.scheduled_date === day))}
      days={DAYS}
      dayWidth={dayWidth}
      bookings={null}
      view={view}
      language="ru"
      unread={unread}
      onOpen={vi.fn()}
      onMore={vi.fn()}
    />,
  );
}

/** The chip a person's name stands in: the press, a button or a link. */
const chipOf = (name: string) =>
  screen.getByRole(name === 'Petr' ? 'link' : 'button', { name: new RegExp(name) });

describe('the mark of an unread message on a chip', () => {
  test.each(['full', 'compact'] as const)(
    'a %s chip carries the picture beside its dot, the words in its name',
    (view) => {
      chips(FULL_WIDTH, view);

      for (const name of ['Anna', 'Petr']) {
        const chip = chipOf(name);
        expect(chip).toHaveAccessibleName(new RegExp(`${WORDS}$`));
        expect(chip).toHaveAttribute('title', expect.stringMatching(new RegExp(`${WORDS}$`)));
        const glyph = chip.querySelector(`svg.${GLYPH}`);
        expect(glyph).not.toBeNull();
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
      }

      const other = chipOf('Iva');
      expect(other).not.toHaveAccessibleName(new RegExp(WORDS));
      expect(other.querySelector(`svg.${GLYPH}`)).toBeNull();
    },
  );

  // Thirty days drew bare dots with a pip on them until the owner's report of
  // 2026-10-12. A chip cut short has no room for the picture beside its dot —
  // beside «+N» it is 12 px wide — so it keeps the pip, in its own corner.
  test.each(['full', 'compact'] as const)(
    'at thirty days a %s chip carries the pip, the words in its name',
    (view) => {
      chips(NARROW_WIDTH, view);

      const chip = chipOf('Anna');
      expect(chip).toHaveAccessibleName(new RegExp(`${WORDS}$`));
      expect(chip.querySelector('[data-slot="chip-unread"]')).toHaveClass(
        'absolute',
        'bg-tone-unread-mark',
      );
      expect(chip.querySelector(`svg.${GLYPH}`)).toBeNull();
      expect(chipOf('Iva').querySelector('[data-slot="chip-unread"]')).toBeNull();
    },
  );

  // The pip is for a chip too narrow for the picture, not for every chip cut
  // short: at fifteen days a full chip is 58 px and the picture fits.
  test.each(['full', 'compact'] as const)(
    'at fifteen days a %s chip carries the picture, as wider ones do',
    (view) => {
      chips(FIFTEEN_DAYS_WIDTH, view);

      const chip = chipOf('Anna');
      expect(chip.querySelector(`svg.${GLYPH}`)).toHaveAttribute('aria-hidden', 'true');
      expect(chip.querySelector('[data-slot="chip-unread"]')).toBeNull();
    },
  );

  // Beside the dot and the picture a chip needs about 26 px of its own; below
  // 40 its name got a sliver, and the pip leaves the name that room.
  test('a chip under 40 px takes the pip, from 40 px the picture', () => {
    const narrow = chips(45);
    expect(chipOf('Anna').querySelector('[data-slot="chip-unread"]')).not.toBeNull();
    narrow.unmount();

    chips(46);
    expect(chipOf('Anna').querySelector(`svg.${GLYPH}`)).not.toBeNull();
    expect(chipOf('Anna').querySelector('[data-slot="chip-unread"]')).toBeNull();
  });

  test('the pip keeps to the corner, clear of the dot it stands by', () => {
    chips(NARROW_WIDTH);

    expect(chipOf('Anna').querySelector('[data-slot="chip-unread"]')).toHaveClass(
      'top-px',
      'right-px',
      'size-1',
      'ring-1',
    );
  });

  test('a chip squeezed beside «+N» at thirty days keeps its pip', () => {
    const crowded = [written, task(DAYS[0]), task(DAYS[0])];
    render(
      <TaskChips
        rowId={1}
        cells={[crowded, [], []]}
        days={DAYS}
        dayWidth={NARROW_WIDTH}
        bookings={null}
        view="full"
        language="ru"
        unread={unread}
        onOpen={vi.fn()}
        onMore={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '+2' })).toBeInTheDocument();
    expect(chipOf('Anna').querySelector('[data-slot="chip-unread"]')).toHaveClass(
      'bg-tone-unread-mark',
    );
  });
});

describe('the mark of an unread message behind «+N»', () => {
  test('the cell’s list says it in words, with the picture beside', () => {
    render(
      <CellTasksDialog
        cell={{ rowId: 1, day: DAYS[0], place: 'Anglicka 7', tasks: [written, quiet] }}
        bookings={null}
        language="ru"
        unread={unread}
        onOpen={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Anglicka 7' });
    const marked = within(dialog).getByRole('button', { name: /Anna/ });
    expect(marked).toHaveTextContent(WORDS);
    expect(marked.querySelector(`svg.${GLYPH}`)).toHaveAttribute('aria-hidden', 'true');
    expect(within(dialog).getByRole('button', { name: /Iva/ })).not.toHaveTextContent(WORDS);
  });
});
