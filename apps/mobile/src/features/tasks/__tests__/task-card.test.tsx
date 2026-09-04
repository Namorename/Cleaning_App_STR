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
    property: { name: 'CZ - Nadrazni Apt 6', cleaner_notes: null },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    ...overrides,
  };
}

test('shows the listing name the cleaner would recognise', async () => {
  await render(<TaskCard task={task()} />);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
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
