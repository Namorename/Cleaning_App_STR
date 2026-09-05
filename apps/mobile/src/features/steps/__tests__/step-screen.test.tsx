import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TaskStep } from '../schema';
import { StepScreen } from '../step-screen';

function step(overrides: Partial<TaskStep> = {}): TaskStep {
  return {
    id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
    task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    sort_order: 1,
    type: 'confirmation',
    required: false,
    title: 'Финальная проверка',
    instructions: 'Окна закрыты\nСвет выключен',
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

const actions = {
  onComplete: jest.fn(),
  onReopen: jest.fn(),
  onSkip: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('confirmation', () => {
  test('shows the instructions and completes with an empty answer', async () => {
    await render(
      <StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />,
    );

    expect(screen.getByText('Окна закрыты')).toBeTruthy();
    expect(screen.getByText('Свет выключен')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Готово' }));

    expect(actions.onComplete).toHaveBeenCalledWith({});
  });

  test('offers to skip an optional step, but not a required one', async () => {
    const { rerender } = await render(
      <StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Пропустить' }));
    expect(actions.onSkip).toHaveBeenCalled();

    await rerender(
      <StepScreen
        step={step({ required: true })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Пропустить' })).toBeNull();
  });
});

describe('task note', () => {
  const note = step({
    type: 'task_note',
    title: null,
    instructions: 'a\r\n\n b \n',
  });

  test('keeps the done button off until every line is ticked, then sends the indexes', async () => {
    await render(<StepScreen step={note} isEditable isBusy={false} error={null} {...actions} />);

    const done = screen.getByRole('button', { name: 'Готово' });
    expect(done).toBeDisabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'b' }));
    await fireEvent.press(done);
    expect(actions.onComplete).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'a' }));
    await fireEvent.press(done);

    expect(actions.onComplete).toHaveBeenCalledWith({ checked_lines: [0, 1] });
  });

  test('shows a done note as read-only with a way back', async () => {
    await render(
      <StepScreen
        step={{
          ...note,
          completed_at: '2026-09-05T10:00:00+00:00',
          payload: { checked_lines: [0, 1] },
        }}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByText(/Выполнен в/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Вернуть в работу' }));

    expect(actions.onReopen).toHaveBeenCalled();
  });
});

describe('cleaner comment', () => {
  test('saves the trimmed text once there is some', async () => {
    await render(
      <StepScreen
        step={step({ type: 'cleaner_comment', title: null, instructions: null })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();

    await fireEvent.changeText(
      screen.getByLabelText('Комментарий'),
      '  Лампа в коридоре перегорела ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));

    expect(actions.onComplete).toHaveBeenCalledWith({ text: 'Лампа в коридоре перегорела' });
  });
});

describe('a step this build cannot do', () => {
  test('explains itself and can only be skipped', async () => {
    await render(
      <StepScreen
        step={step({ type: 'photos_before', title: null })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByText('Этот шаг появится в следующей версии приложения.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Пропустить' })).toBeTruthy();
  });
});

describe('outside the cleaning', () => {
  test('offers nothing once the task is no longer hers to change', async () => {
    await render(
      <StepScreen step={step()} isEditable={false} isBusy={false} error={null} {...actions} />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Шаги можно менять только во время уборки')).toBeTruthy();
  });

  test('shows the reason when the server refused', async () => {
    await render(
      <StepScreen
        step={step()}
        isEditable
        isBusy={false}
        error={new Error('Шаг не найден или задача не в работе')}
        {...actions}
      />,
    );

    expect(screen.getByText('Шаг не найден или задача не в работе')).toBeTruthy();
  });
});
