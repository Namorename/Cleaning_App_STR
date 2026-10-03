import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Problem } from '@/features/problems/schema';
import type { SupplyRequest } from '@/features/supplies/schema';
import {
  calendarTaskSchema,
  liveRepairSchema,
  type CalendarTask,
  type LiveRepair,
  type Property,
} from '@/features/tasks/schema';
import { formatDay } from '@/lib/format-date';

interface Read<T> {
  data: T[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

const read = <T,>(data: T[]): Read<T> => ({ data, isPending: false, isError: false, error: null });

const state: {
  tasks: Read<CalendarTask>;
  problems: Read<Problem>;
  supplies: Read<SupplyRequest>;
  repairs: Read<LiveRepair>;
  rows: Read<Property>;
} = {
  tasks: read([]),
  problems: read([]),
  supplies: read([]),
  repairs: read([]),
  rows: read([]),
};

vi.mock('../use-dashboard', () => ({ useDashboard: () => state }));

import { expectPageTitle } from '@/components/page-header.expect';

import { DashboardView } from '../dashboard-view';

const ANNA = '11111111-1111-4111-8111-111111111111';
const IVA = '22222222-2222-4222-8222-222222222222';

let serial = 0;
const uuid = (prefix: string) => {
  serial += 1;
  return `${prefix}-0000-4000-8000-${String(serial).padStart(12, '0')}`;
};

const task = (day: string, extra: Record<string, unknown> = {}): CalendarTask =>
  calendarTaskSchema.parse({
    id: uuid('00000000'),
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
    property: { name: 'Anglicka 7', timezone: 'Europe/Prague' },
    assignee: null,
    problem: null,
    ...extra,
  });

const free = (day: string, extra: Record<string, unknown> = {}) =>
  task(day, { status: 'unassigned', assignee_id: null, ...extra });

const repair = (day: string, extra: Record<string, unknown> = {}): LiveRepair =>
  liveRepairSchema.parse({
    id: uuid('aaaaaaaa'),
    property_id: 1,
    problem_id: uuid('bbbbbbbb'),
    status: 'assigned',
    scheduled_date: day,
    assignee_id: ANNA,
    assignee: { full_name: 'Anna', is_active: true },
    property: { name: 'Anglicka 7', status: 'active', timezone: 'Europe/Prague' },
    ...extra,
  });

// The counts read the status and the archive mark alone.
const problem = (status: string, archived_at: string | null = null) =>
  ({ status, archived_at }) as unknown as Problem;
const supply = (status: string) => ({ status }) as unknown as SupplyRequest;
// The calendar's rows: the tile counts only what it can draw.
const row = (id: number) => ({ id }) as unknown as Property;

const tile = (name: RegExp) => screen.getByRole('link', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
  state.tasks = read([
    task('2026-09-30'),
    task('2026-09-30', { type: 'midstay', status: 'in_progress' }),
    task('2026-09-30', { status: 'done' }),
    free('2026-09-30'),
    free('2026-09-30', { type: 'inspection' }),
    free('2026-10-01', { type: 'maintenance' }),
    free('2026-10-05'),
    // An inspection on an archived listing: live, but the calendar has no row for it.
    free('2026-10-02', { property_id: 2, type: 'inspection' }),
  ]);
  state.rows = read([row(1)]);
  state.problems = read([
    problem('open'),
    problem('assigned'),
    problem('in_progress'),
    problem('resolved'),
    problem('open', '2026-09-29T08:00:00+00:00'),
  ]);
  state.supplies = read([supply('new'), supply('new'), supply('accepted')]);
  state.repairs = read([repair('2026-10-02')]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the page', () => {
  test('is headed by the common header', () => {
    render(<DashboardView />);

    expectPageTitle('Дашборд');
  });
});

describe('the tiles', () => {
  test('count the day, the week ahead, the sections and the repairs, each leading where it counts', () => {
    state.repairs = read([
      repair('2026-09-28'),
      repair('2026-10-05', { assignee_id: IVA, assignee: { full_name: 'Iva', is_active: false } }),
      repair('2026-09-20', { assignee_id: IVA, assignee: { full_name: 'Iva', is_active: false } }),
    ]);

    render(<DashboardView />);

    // Cleanings and mid-stay cleanings of today: the unassigned cleaning of today is one of them.
    expect(tile(/Уборок сегодня/)).toHaveTextContent('4 · готово 1');
    expect(tile(/Уборок сегодня/)).toHaveAttribute('href', '/tasks');

    const unassigned = tile(/Без исполнителя/);
    expect(unassigned).toHaveTextContent('4');
    expect(unassigned).toHaveTextContent('сегодня 2');
    expect(unassigned).toHaveTextContent('завтра 1');
    expect(unassigned).toHaveAttribute('href', '/calendar?assignee=nobody');

    expect(tile(/Открытых заданий/)).toHaveTextContent('3');
    expect(tile(/Открытых заданий/)).toHaveAttribute('href', '/problems');
    expect(tile(/Новых заявок/)).toHaveTextContent('2');
    expect(tile(/Новых заявок/)).toHaveAttribute('href', '/supplies');

    expect(tile(/Ремонтов просрочено/)).toHaveTextContent('2');
    expect(tile(/Ремонтов просрочено/)).toHaveAttribute('href', '#stuck-repairs');
    expect(tile(/Ремонтов у отключённых/)).toHaveTextContent('2');
    expect(tile(/Ремонтов у отключённых/)).toHaveAttribute('href', '#stuck-repairs');
  });

  test('«Без исполнителя» waits for the calendar’s rows, as it counts only what they draw', () => {
    state.rows = { data: undefined, isPending: true, isError: false, error: null };

    render(<DashboardView />);

    expect(tile(/Без исполнителя/)).toHaveTextContent('…');
  });

  // Next scrolls on the first click only: at the same #stuck-repairs a second
  // click is no navigation to it (dashboard preflight).
  test('the repair tiles bring the list into view on every click', () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled(this.id);
    };
    try {
      render(<DashboardView />);

      fireEvent.click(tile(/Ремонтов просрочено/));
      fireEvent.click(tile(/Ремонтов у отключённых/));
      fireEvent.click(tile(/Ремонтов просрочено/));

      expect(scrolled.mock.calls).toEqual([
        ['stuck-repairs'],
        ['stuck-repairs'],
        ['stuck-repairs'],
      ]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test('a figure still on its way shows an ellipsis, not a zero', () => {
    state.problems = { data: undefined, isPending: true, isError: false, error: null };

    render(<DashboardView />);

    expect(tile(/Открытых заданий/)).toHaveTextContent('…');
    expect(tile(/Открытых заданий/)).not.toHaveTextContent('0');
  });

  test('a figure that could not be read is a dash, and the page says which, with the server’s words', () => {
    state.supplies = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { message: 'permission denied for table supply_requests' },
    };

    render(<DashboardView />);

    expect(tile(/Новых заявок/)).toHaveTextContent('—');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить заявки.');
    expect(alert).toHaveTextContent('permission denied for table supply_requests');
  });
});

describe('the stuck repairs', () => {
  test('are listed oldest first, with the place, the day, who is on it, and the task they fix', () => {
    const late = repair('2026-09-28');
    const both = repair('2026-09-20', {
      assignee_id: IVA,
      assignee: { full_name: 'Iva', is_active: false },
      property: {
        name: 'Unit 1',
        status: 'active',
        timezone: 'Europe/Prague',
        hostaway_unit_id: 7001,
        parent: { name: 'Royal Cerna' },
      },
    });
    const nobody = repair('2026-09-29', { assignee_id: null, assignee: null });
    state.repairs = read([late, both, nobody, repair('2026-10-02')]);

    render(<DashboardView />);

    const list = screen.getByRole('list', { name: 'Застрявшие ремонты' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent('Royal Cerna — Unit 1');
    expect(rows[0]).toHaveTextContent(formatDay('2026-09-20', 'ru'));
    expect(rows[0]).toHaveTextContent('Iva');
    expect(rows[0]).toHaveTextContent('Не работает');
    expect(rows[0]).toHaveTextContent('Просрочен');
    expect(within(rows[0]).getByRole('link', { name: /^Открыть задание/ })).toHaveAttribute(
      'href',
      `/problems/${both.problem_id}`,
    );

    expect(rows[1]).toHaveTextContent(formatDay('2026-09-28', 'ru'));
    expect(rows[1]).toHaveTextContent('Anna');
    expect(rows[1]).not.toHaveTextContent('Не работает');

    expect(rows[2]).toHaveTextContent('Без исполнителя');
  });

  // A screen reader's list of links shows the links alone (dashboard preflight).
  test('each link names the place and the day of its repair', () => {
    state.repairs = read([
      repair('2026-09-20', { assignee: { full_name: 'Iva', is_active: false } }),
      repair('2026-09-28'),
    ]);

    render(<DashboardView />);

    const names = within(screen.getByRole('list', { name: 'Застрявшие ремонты' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual([
      `Открыть задание: Anglicka 7, ${formatDay('2026-09-20', 'ru')}`,
      `Открыть задание: Anglicka 7, ${formatDay('2026-09-28', 'ru')}`,
    ]);
  });

  test('say so when there are none', () => {
    render(<DashboardView />);

    expect(screen.getByText('Застрявших ремонтов нет.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Застрявшие ремонты' })).toBeNull();
  });
});
