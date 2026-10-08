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
 * calendar too. A chip is small, so the mark is a picture beside its dot, or
 * a pip on the dot itself; the words are in its name and its tooltip.
 */

const ANNA = '11111111-1111-4111-8111-111111111111';
const PROBLEM = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];
/** Thirty days: a cell this narrow shows dots. */
const DOT_WIDTH = 30;
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

  test('a dot carries a pip of the unread tone, the words in its name', () => {
    chips(DOT_WIDTH);

    const dot = chipOf('Anna');
    expect(dot).toHaveAccessibleName(new RegExp(`${WORDS}$`));
    expect(dot.querySelector('[data-slot="chip-unread"]')).toHaveClass('bg-tone-unread-mark');
    expect(chipOf('Iva').querySelector('[data-slot="chip-unread"]')).toBeNull();
  });

  // The review of 05.10: a 6 px pip 4 px out of a 7 px dot ran 2 px into the
  // next dot, which painted over it. 4 px, 1 px out, its 1 px ring: within the gap.
  test('the pip keeps to the gap between two dots', () => {
    chips(DOT_WIDTH);

    const pip = chipOf('Anna').querySelector('[data-slot="chip-unread"]');
    expect(pip).toHaveClass('size-1', '-top-px', '-right-px', 'ring-1');
    expect(pip).not.toHaveClass('size-1.5');
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
