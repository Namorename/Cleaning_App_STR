import { THEME_COLORS, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import type { TaskStep } from '../schema';
import { StepList } from '../step-list';

const tones = TONE_COLORS.light;

function styleOf(element: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle);
}

/** The Lucide glyph drawn inside an icon's box (see components/__tests__/icon.test.tsx). */
function glyphIn(row: Parameters<typeof within>[0]): string {
  const box = within(row).getByTestId('step-glyph', { includeHiddenElements: true });
  const [drawing] = box.children;
  if (drawing === undefined || typeof drawing === 'string') {
    throw new Error('the step circle holds no drawing');
  }
  return String(drawing.props.className);
}

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
        step({ id: 'b1c2d3e4-3333-4333-8333-b1c2d3e40003', type: 'inventory' }),
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

describe('the look: «Абрикос» on the old layout', () => {
  const todo = step({ id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001', title: 'Ключи', required: true });
  const done = step({
    id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002',
    title: 'Окна',
    completed_at: '2026-09-05T10:00:00+00:00',
  });
  const skipped = step({
    id: 'b1c2d3e4-3333-4333-8333-b1c2d3e40003',
    title: 'Балкон',
    skipped_at: '2026-09-05T10:05:00+00:00',
  });

  async function renderSteps(): Promise<void> {
    await render(<StepList steps={[todo, done, skipped]} onOpenStep={jest.fn()} />);
  }

  test('each step is a card a row high, for a finger', async () => {
    await renderSteps();

    const row = styleOf(screen.getByRole('button', { name: /Ключи/ }));
    expect(row.minHeight).toBe(TOUCH_TARGET.phoneRow);
    expect(row.backgroundColor).toBe(THEME_COLORS.light.surface);
    expect(row.borderRadius).toBe(20);
  });

  test('a step to do keeps its number, a done one a check, a skipped one a cross', async () => {
    await renderSteps();

    const toDo = screen.getByRole('button', { name: /Ключи/ });
    expect(within(toDo).getByText('1')).toBeTruthy();
    expect(within(toDo).queryByTestId('step-glyph', { includeHiddenElements: true })).toBeNull();
    expect(glyphIn(screen.getByRole('button', { name: /Окна/ }))).toContain('lucide-check');
    expect(glyphIn(screen.getByRole('button', { name: /Балкон/ }))).toContain('lucide-x');
  });

  test('where a step stands is a badge in its tone, with its word', async () => {
    await renderSteps();

    const doneState = within(screen.getByRole('button', { name: /Окна/ })).getByTestId(
      'step-state',
    );
    expect(styleOf(doneState)).toMatchObject({ backgroundColor: tones.done.bg, borderRadius: 999 });
    expect(within(doneState).getByText('Выполнен')).toBeTruthy();

    const skippedState = within(screen.getByRole('button', { name: /Балкон/ })).getByTestId(
      'step-state',
    );
    expect(styleOf(skippedState).backgroundColor).toBe(tones.cancelled.bg);
  });

  test('a required step says so as a neutral badge', async () => {
    await renderSteps();

    const required = within(screen.getByRole('button', { name: /Ключи/ })).getByTestId(
      'step-required',
    );
    expect(styleOf(required).backgroundColor).toBe(tones.neutral.bg);
    expect(within(required).getByText('Обязательный')).toBeTruthy();
  });

  test('the reader still hears the number, the name and the state as one', async () => {
    await renderSteps();

    expect(screen.getByRole('button', { name: '2. Окна. Выполнен' })).toBeTruthy();
  });
});
