import { fireEvent, render, screen } from '@testing-library/react-native';

import { TaskCard } from '../task-card';
import type { CleaningTask } from '../schema';

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'unassigned',
    priority: 0,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: null,
    property_id: 412432,
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    ...overrides,
  };
}

test('shows the listing name the cleaner would recognise', async () => {
  await render(<TaskCard task={task()} />);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});

test('names the building first and the room under it', async () => {
  // Arrange: a cleaning standing on a room of a multi-unit listing. "1 - 2109"
  // is the only name the row carries and it names no house at all.
  const inRoom = task({
    property: {
      name: '1 - 2109',
      address: 'Vinohradská 2109/10',
      hostaway_unit_id: 18007,
      cleaner_notes: null,
      parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
    },
  });

  // Act
  await render(<TaskCard task={inRoom} />);

  // Assert: both, and the house is the heading.
  expect(screen.getByText('CZ - Vinohradska Royal Apt 1.3.5.7')).toBeTruthy();
  expect(screen.getByText('1 - 2109')).toBeTruthy();
});

test('a fix on a room is named by what is broken, and says which flat in which house', async () => {
  // A maintenance card is titled by the problem, so the flat lives in the line
  // under it — and that line has to carry the house, not just "1 - 2109".
  const fix = task({
    type: 'maintenance',
    problem: {
      id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      title: 'Течёт кран',
      priority: 'high',
    },
    property: {
      name: '1 - 2109',
      address: 'Vinohradská 2109/10',
      hostaway_unit_id: 18007,
      cleaner_notes: null,
      parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
    },
  });

  await render(<TaskCard task={fix} />);

  expect(screen.getByText('Течёт кран')).toBeTruthy();
  expect(screen.getByText(/CZ - Vinohradska Royal Apt 1\.3\.5\.7 — 1 - 2109/)).toBeTruthy();
});

test('a task whose listing did not come with it is still named by its id', async () => {
  await render(<TaskCard task={task({ property: null })} />);

  expect(screen.getByText('Объект 412432')).toBeTruthy();
});

test('states a same-day turnover as the check-in time', async () => {
  await render(<TaskCard task={task({ priority: 1, due_at: '2026-11-10T13:00:00+00:00' })} />);

  expect(screen.getByText(/^В \d{2}:\d{2} заезд$/)).toBeTruthy();
});

test('shows an ordinary cleaning as one with nobody arriving', async () => {
  await render(<TaskCard task={task({ priority: 0 })} />);

  expect(screen.getByText('Заезда нет')).toBeTruthy();
});

test('states the check-in once, in the line that gives it meaning', async () => {
  await render(<TaskCard task={task({ priority: 1, due_at: '2026-11-10T13:00:00+00:00' })} />);

  // The window line carries clock times of its own; the check-in is not one
  // of them repeated, and the old "· до 15:00" tail is gone for good.
  expect(screen.getAllByText(/заезд/)).toHaveLength(1);
  expect(screen.queryByText(/ · до \d{2}:\d{2}/)).toBeNull();
});

test('offers no claim button in the list of tasks already assigned', async () => {
  await render(<TaskCard task={task()} />);

  expect(screen.queryByRole('button', { name: /Взять уборку/ })).toBeNull();
});

test('claims the task it was given when the button is pressed', async () => {
  const onClaim = jest.fn();
  await render(<TaskCard task={task()} onClaim={onClaim} />);

  await fireEvent.press(screen.getByRole('button', { name: /Взять уборку/ }));

  expect(onClaim).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
});

test('does not fire a second claim while the first is in flight', async () => {
  const onClaim = jest.fn();
  await render(<TaskCard task={task()} onClaim={onClaim} isClaiming />);

  await fireEvent.press(screen.getByRole('button', { name: /Взять уборку/ }));

  expect(onClaim).not.toHaveBeenCalled();
});

test('shows the window the cleaning has to fit into', async () => {
  await render(<TaskCard task={task({ time_from: '10:00:00', time_to: '15:00:00' })} />);

  expect(screen.getByText(/10:00–15:00/)).toBeTruthy();
});

test('says in words that a cleaning is under way', async () => {
  await render(<TaskCard task={task({ status: 'in_progress' })} />);

  expect(screen.getByText('В работе')).toBeTruthy();
});

test('opens the task when the card is pressed', async () => {
  const onPress = jest.fn();
  await render(<TaskCard task={task()} onPress={onPress} />);

  await fireEvent.press(screen.getByRole('button', { name: /CZ - Nadrazni Apt 6/ }));

  expect(onPress).toHaveBeenCalledWith('3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b');
});
