import { THEME_COLORS, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { MAX_COMMENT_LENGTH, type TaskStep } from '../schema';
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
    title_i18n: {},
    instructions_i18n: {},
    config: {},
    min_photos: null,
    max_photos: null,
    max_video_sec: null,
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
    await render(<StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />);

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
        step={step({ type: 'inventory', title: null })}
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
    // A step belongs to a cleaning, an inspection or a repair alike.
    expect(screen.getByText('Шаги можно менять, только пока уборка в работе')).toBeTruthy();
  });

  test('shows the refusal in the language of the cleaner, not of the server', async () => {
    await render(
      <StepScreen
        step={step()}
        isEditable
        isBusy={false}
        error={Object.assign(new Error('Step not found, or its task is not in progress'), {
          hint: 'serverErrors.stepNotFound',
        })}
        {...actions}
      />,
    );

    expect(screen.getByText('Шаг не найден или уборка уже не в работе')).toBeTruthy();
    expect(screen.queryByText('Step not found, or its task is not in progress')).toBeNull();
  });
});

describe('the words of the step', () => {
  test('reads the title and the instructions in the language of the cleaner', async () => {
    await render(
      <StepScreen
        step={step({
          title: 'Závěrečná kontrola',
          title_i18n: { ru: 'Финальная проверка' },
          instructions: 'Okna zavřená',
          instructions_i18n: { ru: 'Окна закрыты' },
        })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByText('Финальная проверка')).toBeTruthy();
    expect(screen.getByText('Окна закрыты')).toBeTruthy();
  });

  test('keeps what the manager wrote when her language is missing', async () => {
    await render(
      <StepScreen
        step={step({ title: 'Závěrečná kontrola', instructions: 'Okna zavřená' })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByText('Závěrečná kontrola')).toBeTruthy();
    expect(screen.getByText('Okna zavřená')).toBeTruthy();
  });
});

describe('checklist', () => {
  const checklist = step({
    type: 'checklist',
    title: null,
    instructions: null,
    config: {
      modules: [
        {
          id: 'm1',
          title: 'Ванная',
          items: [
            { id: 'i1', title: 'Зеркало', is_optional: false },
            { id: 'i2', title: 'Балкон', is_optional: true },
          ],
        },
        {
          id: 'm2',
          title: 'Кухня',
          items: [{ id: 'i3', title: 'Плита', is_optional: false }],
        },
      ],
    },
  });

  test('holds the done button until every required item is ticked, then sends the ids', async () => {
    await render(
      <StepScreen step={checklist} isEditable isBusy={false} error={null} {...actions} />,
    );

    const done = screen.getByRole('button', { name: 'Готово' });
    expect(done).toBeDisabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Зеркало' }));
    await fireEvent.press(done);
    expect(actions.onComplete).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Плита' }));
    await fireEvent.press(done);

    // The optional item was never touched, and the step still finished.
    expect(actions.onComplete).toHaveBeenCalledWith({ checked_item_ids: ['i1', 'i3'] });
  });

  test('an optional item may be ticked too, and travels with the answer', async () => {
    await render(
      <StepScreen step={checklist} isEditable isBusy={false} error={null} {...actions} />,
    );

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Зеркало' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Балкон' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Плита' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Готово' }));

    expect(actions.onComplete).toHaveBeenCalledWith({ checked_item_ids: ['i1', 'i2', 'i3'] });
  });

  test('shows how much of the checklist is done', async () => {
    await render(
      <StepScreen step={checklist} isEditable isBusy={false} error={null} {...actions} />,
    );

    expect(screen.getByText('Отмечено 0 из 3')).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Зеркало' }));

    expect(screen.getByText('Отмечено 1 из 3')).toBeTruthy();
  });

  test('starts from the answer already recorded', async () => {
    await render(
      <StepScreen
        step={{ ...checklist, payload: { checked_item_ids: ['i1', 'i3'] } }}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByText('Отмечено 2 из 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Готово' })).not.toBeDisabled();
  });
});

describe('photos', () => {
  const photos = step({
    type: 'photos_before',
    title: null,
    instructions: null,
    min_photos: 1,
    max_photos: 2,
  });
  const uploaded = {
    id: 'm1',
    kind: 'photo' as const,
    uri: null,
    status: 'uploaded' as const,
    durationSec: null,
  };

  test('keeps the done button off until every photo has arrived, then completes with nothing to add', async () => {
    const { rerender } = await render(
      <StepScreen
        step={photos}
        isEditable
        isBusy={false}
        error={null}
        media={[{ ...uploaded, status: 'uploading' }]}
        {...actions}
      />,
    );

    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
    expect(screen.getByLabelText('Фото 1. Загружается…')).toBeTruthy();

    await rerender(
      <StepScreen
        step={photos}
        isEditable
        isBusy={false}
        error={null}
        media={[uploaded]}
        {...actions}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Готово' }));

    // The server answers from its own table; the phone has nothing to add.
    expect(actions.onComplete).toHaveBeenCalledWith({});
  });

  test('hands the camera and the tiles to the route', async () => {
    const onCapture = jest.fn();
    const onRemoveMedia = jest.fn();
    await render(
      <StepScreen
        step={photos}
        isEditable
        isBusy={false}
        error={null}
        media={[uploaded]}
        onCapture={onCapture}
        onRemoveMedia={onRemoveMedia}
        {...actions}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Снять фото' }));
    expect(onCapture).toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
    expect(onRemoveMedia).toHaveBeenCalledWith('m1');
  });

  test('shows what the camera said when it refused', async () => {
    await render(
      <StepScreen
        step={photos}
        isEditable
        isBusy={false}
        error={null}
        notice="Нет доступа к камере — разрешите его в настройках телефона"
        {...actions}
      />,
    );

    expect(
      screen.getByText('Нет доступа к камере — разрешите его в настройках телефона'),
    ).toBeTruthy();
  });
});

describe('the look: «Абрикос» on the old layout', () => {
  const light = THEME_COLORS.light;
  const tones = TONE_COLORS.light;

  function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
    return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('«Готово» is the main button: 56 dp, in the sun-proof colours', async () => {
    await render(<StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />);

    const done = styleOf(screen.getByRole('button', { name: 'Готово' }));
    expect(done.minHeight).toBe(TOUCH_TARGET.phoneButton);
    expect(done.backgroundColor).toBe(light.cta);
  });

  test('skipping and taking a step back are framed buttons of the same height', async () => {
    const { rerender } = await render(
      <StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />,
    );
    const skip = styleOf(screen.getByRole('button', { name: 'Пропустить' }));
    expect(skip).toMatchObject({
      minHeight: TOUCH_TARGET.phoneButton,
      borderColor: light.primary,
      backgroundColor: 'transparent',
    });

    await rerender(
      <StepScreen
        step={step({ completed_at: '2026-09-05T10:00:00+00:00' })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );
    const reopen = styleOf(screen.getByRole('button', { name: 'Вернуть в работу' }));
    expect(reopen).toMatchObject({
      minHeight: TOUCH_TARGET.phoneButton,
      borderColor: light.primary,
    });
  });

  test('a required step says so as a neutral badge', async () => {
    await render(
      <StepScreen
        step={step({ required: true })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    const required = screen.getByTestId('step-required');
    expect(styleOf(required)).toMatchObject({
      backgroundColor: tones.neutral.bg,
      borderRadius: 999,
    });
    expect(within(required).getByText('Обязательный')).toBeTruthy();
  });

  test('where the step stands is a badge in its tone, with its words', async () => {
    const { rerender } = await render(
      <StepScreen
        step={step({ completed_at: '2026-09-05T10:00:00+00:00' })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );
    const done = screen.getByTestId('step-status');
    expect(styleOf(done).backgroundColor).toBe(tones.done.bg);
    expect(within(done).getByText(/Выполнен в/)).toBeTruthy();

    await rerender(
      <StepScreen
        step={step({ waived_at: '2026-09-05T10:00:00+00:00', waive_reason: 'нет заметки' })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );
    const waived = screen.getByTestId('step-status');
    expect(styleOf(waived).backgroundColor).toBe(tones.cancelled.bg);
    expect(within(waived).getByText('Снят менеджером: нет заметки')).toBeTruthy();
  });

  test('the comment is a field with its name above it, held to the same length', async () => {
    await render(
      <StepScreen
        step={step({ type: 'cleaner_comment', title: 'Что сломалось', instructions: null })}
        isEditable
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    // The name of the field is on screen, not only read out.
    expect(screen.getByText('Комментарий')).toBeTruthy();
    const field = screen.getByLabelText('Комментарий');
    expect(field.props.maxLength).toBe(MAX_COMMENT_LENGTH);
    expect(field.props.multiline).toBe(true);
    expect(styleOf(field).borderColor).toBe(light.border);
    expect(screen.getByText(`0 / ${MAX_COMMENT_LENGTH}`)).toBeTruthy();
  });

  test('a closed step offers no field to type in', async () => {
    await render(
      <StepScreen
        step={step({ type: 'cleaner_comment', instructions: null })}
        isEditable={false}
        isBusy={false}
        error={null}
        {...actions}
      />,
    );

    expect(screen.getByLabelText('Комментарий').props.editable).toBe(false);
  });

  test('at the largest system font «Готово» still carries its whole label', async () => {
    // Arrange: a small phone with the font turned all the way up.
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 320, height: 640, scale: 3, fontScale: 3.1 });

    // Act
    await render(<StepScreen step={step()} isEditable isBusy={false} error={null} {...actions} />);

    // Assert
    const done = screen.getByRole('button', { name: 'Готово' });
    const label = within(done).getByText('Готово');
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.allowFontScaling).not.toBe(false);
    expect(styleOf(done).height).toBeUndefined();
    expect(styleOf(done).minHeight).toBe(TOUCH_TARGET.phoneButton);
  });
});
