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
    property: { name: 'CZ - Nadrazni Apt 6' },
    ...overrides,
  };
}

test('shows the listing name the cleaner would recognise', async () => {
  await render(<TaskCard task={task()} />);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
});

test('marks a same-day turnover in words, not only in colour', async () => {
  await render(<TaskCard task={task({ priority: 1 })} />);

  expect(screen.getByText('Срочно')).toBeTruthy();
});

test('shows an ordinary cleaning as ordinary', async () => {
  await render(<TaskCard task={task({ priority: 0 })} />);

  expect(screen.getByText('Обычная')).toBeTruthy();
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
