import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TaskStep } from '../schema';
import { StepList } from '../step-list';

function step(overrides: Partial<TaskStep> = {}): TaskStep {
  return {
    id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
    task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    sort_order: 1,
    type: 'confirmation',
    required: false,
    title: null,
    instructions: null,
    started_at: null,
    completed_at: null,
    completed_by: null,
    payload: {},
    skipped_at: null,
    skip_reason: null,
    waived_at: null,
    waive_reason: null,
    ...overrides,
  };
}

test('names each step by the manager wording, or by its type when there is none', async () => {
  await render(
    <StepList
      steps={[
        step({ id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001', title: 'Финальная проверка' }),
        step({ id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002', type: 'cleaner_comment' }),
      ]}
      onOpenStep={jest.fn()}
    />,
  );

  expect(screen.getByText('Финальная проверка')).toBeTruthy();
  expect(screen.getByText('Комментарий')).toBeTruthy();
});

test('marks a required step and says where each step stands', async () => {
  await render(
    <StepList
      steps={[
        step({ id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001', required: true }),
        step({
          id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002',
          completed_at: '2026-09-05T10:00:00+00:00',
        }),
        step({ id: 'b1c2d3e4-3333-4333-8333-b1c2d3e40003', type: 'photos_before' }),
      ]}
      onOpenStep={jest.fn()}
    />,
  );

  expect(screen.getByText('Обязательный')).toBeTruthy();
  expect(screen.getByText('Не выполнен')).toBeTruthy();
  expect(screen.getByText('Выполнен')).toBeTruthy();
  expect(screen.getByText('Недоступен в этой версии')).toBeTruthy();
});

test('numbers steps by position, so a step left out at snapshot time leaves no gap', async () => {
  await render(
    <StepList
      steps={[
        step({ id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001', sort_order: 2 }),
        step({ id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002', sort_order: 3 }),
      ]}
      onOpenStep={jest.fn()}
    />,
  );

  expect(screen.getByText('1')).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.queryByText('3')).toBeNull();
});

test('opens the step that was pressed', async () => {
  const onOpenStep = jest.fn();
  await render(
    <StepList
      steps={[step({ id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001', title: 'Ключи' })]}
      onOpenStep={onOpenStep}
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: /Ключи/ }));

  expect(onOpenStep).toHaveBeenCalledWith('b1c2d3e4-1111-4111-8111-b1c2d3e40001');
});
