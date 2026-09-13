import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { taskSchema, type Task } from '../schema';

/**
 * The listing field, on a company that has rooms.
 *
 * Nine listings hold rooms, and since the cleanings moved onto the rooms this
 * field has to name one. A room's own name — "1 - 2109", "Unit 3 - 7013" —
 * never says which building it is in, and a native select shows only the
 * chosen option's text when it is closed, so the building has to be in the
 * option itself rather than in a heading above it.
 */

const ROYAL = 219524;
const ROOM_ONE = 1000000018007;
const ANGLICKA = 98352;

const properties = [
  { id: ROYAL, name: 'CZ - Vinohradska Royal', parent_id: null, hostaway_unit_id: null },
  { id: ROOM_ONE, name: '1 - 2109', parent_id: ROYAL, hostaway_unit_id: 18007 },
  { id: ANGLICKA, name: 'Anglicka 7', parent_id: null, hostaway_unit_id: null },
];

const mutate = vi.fn();

vi.mock('../use-tasks', () => ({
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useStaff: () => ({ data: [], isPending: false, isError: false }),
  useSaveTask: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (...args: unknown[]) => mutate(...args),
    reset: vi.fn(),
  }),
}));

import { TaskForm } from '../task-form';

const base = {
  property_id: ANGLICKA,
  reservation_id: null,
  problem_id: null,
  type: 'cleaning',
  status: 'assigned',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: '2026-09-14',
  time_from: '10:00:00',
  time_to: '15:00:00',
  started_at: null,
  completed_at: null,
  measured_minutes: null,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-09-10T08:00:00+00:00',
  property: { name: 'Anglicka 7' },
  assignee: null,
  author: null,
};

const task = (overrides: Record<string, unknown>): Task =>
  taskSchema.parse({ ...base, ...overrides });

const listingField = () => screen.getByLabelText('Объект') as HTMLSelectElement;
const chosen = (select: HTMLSelectElement) =>
  select.selectedIndex < 0 ? null : select.options[select.selectedIndex].textContent;

describe('the listing field of a task that stands on a room', () => {
  test('names the building and the room, not the placeholder', () => {
    render(
      <TaskForm
        task={task({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
          property_id: ROOM_ONE,
          reservation_id: 900009951,
          property: { name: '1 - 2109' },
        })}
        onClose={() => {}}
      />,
    );

    const field = listingField();
    expect(field.value).toBe(String(ROOM_ONE));
    expect(chosen(field)).toBe('CZ - Vinohradska Royal — 1 - 2109');
  });

  test('an ordinary listing reads as it always did', () => {
    render(
      <TaskForm
        task={task({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', reservation_id: 900009952 })}
        onClose={() => {}}
      />,
    );

    expect(chosen(listingField())).toBe('Anglicka 7');
  });

  test('it stays locked: the server refuses to move a generated task anyway', () => {
    render(
      <TaskForm
        task={task({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
          property_id: ROOM_ONE,
          reservation_id: 900009951,
        })}
        onClose={() => {}}
      />,
    );

    expect(listingField().disabled).toBe(true);
  });
});

describe('the listing field when the manager writes a task by hand', () => {
  test('offers the rooms too — a broken shower is in one flat, not in the building', async () => {
    render(<TaskForm task={null} onClose={() => {}} />);

    await userEvent.selectOptions(listingField(), String(ROOM_ONE));

    expect(listingField().value).toBe(String(ROOM_ONE));
  });

  test('lists every room under its own listing', () => {
    render(<TaskForm task={null} onClose={() => {}} />);

    expect(
      Array.from(listingField().options)
        .map((option) => option.textContent)
        .filter((label) => label !== 'Выберите объект'),
    ).toEqual([
      'Anglicka 7',
      'CZ - Vinohradska Royal',
      'CZ - Vinohradska Royal — 1 - 2109',
    ]);
  });

  test('sends the room it was given, not the building above it', async () => {
    mutate.mockClear();
    render(<TaskForm task={null} onClose={() => {}} />);

    await userEvent.selectOptions(listingField(), String(ROOM_ONE));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(mutate.mock.calls[0][0].draft.propertyId).toBe(ROOM_ONE);
  });
});
