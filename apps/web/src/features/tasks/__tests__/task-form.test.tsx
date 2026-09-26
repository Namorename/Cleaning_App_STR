import { fireEvent, render, screen } from '@testing-library/react';
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

const PETR = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
  full_name: 'Petr Dvořák',
  role: 'tech',
};
const staff = [PETR];

const mutate = vi.fn();
const JAN = { id: 58123, guest_name: 'Jan Novák' };
interface GuestState {
  data: { id: number; guest_name: string | null } | undefined;
  isPending: boolean;
  isError: boolean;
}
const guest = vi.fn<(reservationId: number) => GuestState>(() => ({
  data: JAN,
  isPending: false,
  isError: false,
}));

vi.mock('../use-tasks', () => ({
  useReservationGuest: (reservationId: number) => guest(reservationId),
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useStaff: () => ({ data: staff, isPending: false, isError: false }),
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

/**
 * The booking behind a cleaning. The manager changing a generated cleaning
 * needs to know whose stay it closes, and the booking's number to look it up
 * in Hostaway. The panel only: the cleaner's phone never shows a guest.
 */
describe('the booking behind a cleaning', () => {
  const cleaning = () =>
    task({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', reservation_id: JAN.id });

  test('shows who is leaving and the Hostaway booking id', () => {
    guest.mockClear();

    render(<TaskForm task={cleaning()} onClose={() => {}} />);

    expect(screen.getByText('Выезжающий гость')).toBeTruthy();
    expect(screen.getByText('Jan Novák')).toBeTruthy();
    expect(screen.getByText('Бронь в Hostaway')).toBeTruthy();
    expect(screen.getByText('58123')).toBeTruthy();
    expect(guest).toHaveBeenLastCalledWith(JAN.id);
  });

  test('a booking without a name says so rather than leaving a blank', () => {
    guest.mockReturnValueOnce({
      data: { id: JAN.id, guest_name: null },
      isPending: false,
      isError: false,
    });

    render(<TaskForm task={cleaning()} onClose={() => {}} />);

    expect(screen.getByText('не указан')).toBeTruthy();
  });

  test('while the name is on its way the field says so, not that the tasks are loading', () => {
    guest.mockReturnValueOnce({ data: undefined, isPending: true, isError: false });

    render(<TaskForm task={cleaning()} onClose={() => {}} />);

    expect(screen.getByText('Загружаем…')).toBeTruthy();
    expect(screen.queryByText('Загружаем задания…')).toBeNull();
  });

  test('a name that could not be read does not hide the booking id', () => {
    guest.mockReturnValueOnce({ data: undefined, isPending: false, isError: true });

    render(<TaskForm task={cleaning()} onClose={() => {}} />);

    expect(screen.getByText('не удалось загрузить')).toBeTruthy();
    expect(screen.getByText('58123')).toBeTruthy();
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

  test('a task written by hand has no booking to show', () => {
    render(
      <TaskForm task={task({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004' })} onClose={() => {}} />,
    );

    expect(screen.queryByText('Бронь в Hostaway')).toBeNull();
    expect(screen.queryByText('Выезжающий гость')).toBeNull();
  });

  test('sends the room it was given, not the building above it', async () => {
    mutate.mockClear();
    render(<TaskForm task={null} onClose={() => {}} />);

    await userEvent.selectOptions(listingField(), String(ROOM_ONE));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(mutate.mock.calls[0][0].draft.propertyId).toBe(ROOM_ONE);
  });
});

/**
 * An inspection or a maintenance job is somebody's from the moment it is
 * written (the owner's decision): one left to nobody is one nobody does, and
 * unlike a cleaning there is no generator to hand it out later. The panel
 * holds the line on its own; the server still accepts an unassigned task.
 */
describe('an inspection or a maintenance job always has an executor', () => {
  const REQUIRED = 'Осмотру и обслуживанию нужен исполнитель: выберите, кто сделает задание.';

  const typeField = () => screen.getByLabelText('Тип задания') as HTMLSelectElement;
  const assigneeField = () => screen.getByLabelText('Исполнитель') as HTMLSelectElement;
  const nobody = () =>
    Array.from(assigneeField().options).find((option) => option.value === '') as HTMLOptionElement;
  const saveButton = () => screen.getByRole('button', { name: 'Сохранить' });
  const submitForm = () => fireEvent.submit(saveButton().closest('form') as HTMLFormElement);

  test.each(['inspection', 'maintenance'])(
    'switching a new task to %s with nobody says why and does not send',
    async (type) => {
      mutate.mockClear();
      render(<TaskForm task={null} onClose={() => {}} />);

      await userEvent.selectOptions(listingField(), String(ANGLICKA));
      await userEvent.selectOptions(typeField(), type);

      expect(screen.getByText(REQUIRED)).toBeInTheDocument();
      expect(assigneeField()).toHaveAttribute('aria-invalid', 'true');
      expect(nobody().disabled).toBe(true);
      expect(saveButton()).toBeDisabled();
      submitForm();
      expect(mutate).not.toHaveBeenCalled();
    },
  );

  test('picking somebody clears the error, and the save carries them', async () => {
    mutate.mockClear();
    render(<TaskForm task={null} onClose={() => {}} />);

    await userEvent.selectOptions(listingField(), String(ANGLICKA));
    await userEvent.selectOptions(typeField(), 'inspection');
    await userEvent.selectOptions(assigneeField(), PETR.id);

    expect(screen.queryByText(REQUIRED)).toBeNull();
    await userEvent.click(saveButton());
    expect(mutate.mock.calls[0][0].draft).toMatchObject({
      type: 'inspection',
      assigneeId: PETR.id,
    });
  });

  test('an existing inspection cannot be left without its executor', () => {
    mutate.mockClear();
    render(
      <TaskForm
        task={task({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000011',
          type: 'inspection',
          assignee_id: PETR.id,
        })}
        onClose={() => {}}
      />,
    );

    expect(assigneeField().value).toBe(PETR.id);
    expect(nobody().disabled).toBe(true);
    expect(screen.queryByText(REQUIRED)).toBeNull();

    // A disabled option can still be reached by a script or an old browser;
    // the form must not trust the option alone.
    fireEvent.change(assigneeField(), { target: { value: '' } });

    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    submitForm();
    expect(mutate).not.toHaveBeenCalled();
  });

  test('a maintenance job from a report that nobody has yet asks for somebody', () => {
    mutate.mockClear();
    render(
      <TaskForm
        task={task({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000012',
          type: 'maintenance',
          problem_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
          assignee_id: null,
        })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    submitForm();
    expect(mutate).not.toHaveBeenCalled();
  });

  test.each(['cleaning', 'midstay'])(
    'a %s may still wait in the queue for somebody',
    async (type) => {
      mutate.mockClear();
      render(<TaskForm task={null} onClose={() => {}} />);

      await userEvent.selectOptions(listingField(), String(ANGLICKA));
      await userEvent.selectOptions(typeField(), type);

      expect(nobody().disabled).toBe(false);
      expect(screen.queryByText(REQUIRED)).toBeNull();
      await userEvent.click(saveButton());
      expect(mutate.mock.calls[0][0].draft).toMatchObject({ type, assigneeId: null });
    },
  );
});

/**
 * The executor list holds active colleagues only. A job still assigned to
 * somebody who has since been switched off matches no option, and a browser
 * then shows the first option it may pick — with "nobody" disabled on an
 * inspection, that is a real colleague who was never asked.
 */
describe('an executor who has been switched off', () => {
  const REQUIRED = 'Осмотру и обслуживанию нужен исполнитель: выберите, кто сделает задание.';
  const GONE = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000009', full_name: 'Eva Svobodová' };

  const assigneeField = () => screen.getByLabelText('Исполнитель') as HTMLSelectElement;
  const saveButton = () => screen.getByRole('button', { name: 'Сохранить' });
  const assignedToGone = (type: string) =>
    task({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000013',
      type,
      assignee_id: GONE.id,
      assignee: { full_name: GONE.full_name },
    });

  test('an inspection shows them as they are and asks for somebody who can do it', () => {
    mutate.mockClear();
    render(<TaskForm task={assignedToGone('inspection')} onClose={() => {}} />);

    expect(assigneeField().value).toBe(GONE.id);
    expect(chosen(assigneeField())).toBe('Eva Svobodová — нет доступа');
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  test('picking an active colleague hands the job over', async () => {
    mutate.mockClear();
    render(<TaskForm task={assignedToGone('maintenance')} onClose={() => {}} />);

    await userEvent.selectOptions(assigneeField(), PETR.id);

    expect(screen.queryByText(REQUIRED)).toBeNull();
    await userEvent.click(saveButton());
    expect(mutate.mock.calls[0][0].draft).toMatchObject({ assigneeId: PETR.id });
  });

  test('a cleaning shows them too, and may still be saved as it is', async () => {
    mutate.mockClear();
    render(<TaskForm task={assignedToGone('cleaning')} onClose={() => {}} />);

    expect(chosen(assigneeField())).toBe('Eva Svobodová — нет доступа');
    expect(screen.queryByText(REQUIRED)).toBeNull();
    await userEvent.click(saveButton());
    expect(mutate.mock.calls[0][0].draft).toMatchObject({ assigneeId: GONE.id });
  });
});
