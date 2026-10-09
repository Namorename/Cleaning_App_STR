import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { StyleSheet, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT } from '@/constants/theme';
import type { ReportProperty } from '@/features/properties/schema';

import { ProblemForm } from '../problem-form';
import { EMPTY_PROBLEM_DRAFT, type ProblemDraft } from '../schema';

/**
 * What is broken, in her words. The owner's variant 1: photos first, then the
 * place as a field that opens a sheet, then what happened and the details; the
 * button pinned under the form instead of at the end of it
 * (docs/design/decisions.md §2).
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => false }));

/**
 * The keyboard is native, so what is checked is what the form asks of React
 * Native's KeyboardAvoidingView: the props it was drawn with are recorded.
 */
const mockAvoidingProps: { behavior?: string; keyboardVerticalOffset?: number }[] = [];

jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function MockKeyboardAvoidingView(props: {
    behavior?: string;
    keyboardVerticalOffset?: number;
    children?: unknown;
  }) {
    mockAvoidingProps.push(props);
    return createElement(View, null, props.children);
  }
  return { __esModule: true, default: MockKeyboardAvoidingView };
});

type FormProps = Parameters<typeof ProblemForm>[0];

const places: ReportProperty[] = [
  { id: 1, name: 'Nadrazni 6', parent_id: null, hostaway_unit_id: null, parent_name: null },
  { id: 2, name: '1 - 2109', parent_id: 1, hostaway_unit_id: 2, parent_name: 'Vinohradska Royal' },
];

const SEND = 'Отправить';
const REFUSAL = Object.assign(new Error('The title is longer than 200 characters'), {
  hint: 'serverErrors.problemTitleTooLong',
  details: '{"limit": 200}',
});

async function renderForm(draft: ProblemDraft, overrides: Partial<FormProps> = {}) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  await render(
    <ProblemForm
      draft={draft}
      onChange={onChange}
      place="CZ - Nadrazni Apt 6"
      photos={[]}
      onCapture={jest.fn()}
      isSubmitting={false}
      submitLabel={SEND}
      onSubmit={onSubmit}
      error={null}
      {...overrides}
    />,
  );
  return { onChange, onSubmit };
}

/** What scrolls: the form's own scroll view, not the strip of photos inside it. */
function scrollingForm() {
  const [form] = screen.container.queryAll(
    (node) => node.type === 'RCTScrollView' && node.props.horizontal !== true,
  );
  return form;
}

/** The labels of the form's fields, top to bottom. */
function fieldOrder(): string[] {
  return screen
    .getAllByText(/^(Фото|Где|Что случилось|Подробности|Срочность)$/)
    .map((node) => String(node.props.children));
}

test('keeps the button grey until there is a title', async () => {
  const { onSubmit } = await renderForm(EMPTY_PROBLEM_DRAFT);

  const button = screen.getByRole('button', { name: SEND });
  expect(button).toBeDisabled();
  await fireEvent.press(button);

  expect(onSubmit).not.toHaveBeenCalled();
});

test('sends once a title is there', async () => {
  const { onSubmit } = await renderForm({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран течёт' });

  await fireEvent.press(screen.getByRole('button', { name: SEND }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('while it goes, the button says it is busy and a second tap sends nothing', async () => {
  const { onSubmit } = await renderForm(
    { ...EMPTY_PROBLEM_DRAFT, title: 'Кран течёт' },
    { isSubmitting: true },
  );

  const button = screen.getByRole('button', { name: SEND });
  expect(button).toBeBusy();
  await fireEvent.press(button);

  expect(onSubmit).not.toHaveBeenCalled();
});

test('hands every keystroke back as a new draft', async () => {
  const { onChange } = await renderForm(EMPTY_PROBLEM_DRAFT);

  await fireEvent.changeText(screen.getByLabelText('Что случилось'), 'Кран');
  await fireEvent.changeText(screen.getByLabelText('Подробности'), 'На кухне');

  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран' });
  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_PROBLEM_DRAFT, description: 'На кухне' });
});

test('offers the three priorities as radios and reports the choice', async () => {
  const { onChange } = await renderForm(EMPTY_PROBLEM_DRAFT);

  await fireEvent.press(screen.getByRole('radio', { name: 'Высокая' }));

  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_PROBLEM_DRAFT, priority: 'high' });
  expect(screen.getByRole('radio', { name: 'Обычная' })).toBeSelected();
});

test('shows where the problem is and offers the camera', async () => {
  await renderForm(EMPTY_PROBLEM_DRAFT);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Снять фото' })).toBeTruthy();
});

test('a new report reads top to bottom: photos, the place, what happened, the details', async () => {
  await renderForm(EMPTY_PROBLEM_DRAFT, {
    place: null,
    properties: places,
    selectedPropertyId: null,
    onSelectProperty: jest.fn(),
  });

  expect(fieldOrder()).toEqual(['Фото', 'Где', 'Что случилось', 'Подробности', 'Срочность']);
});

test('the place she chooses is a field that opens her places in a sheet', async () => {
  const onSelectProperty = jest.fn();
  await renderForm(EMPTY_PROBLEM_DRAFT, {
    place: null,
    properties: places,
    selectedPropertyId: null,
    onSelectProperty,
  });

  await fireEvent.press(screen.getByRole('button', { name: 'Где' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Vinohradska Royal — 1 - 2109' }));

  expect(onSelectProperty).toHaveBeenCalledWith(2);
});

test('a report filed on a task names its place and offers no choice', async () => {
  await renderForm(EMPTY_PROBLEM_DRAFT);

  expect(fieldOrder()).toEqual(['Фото', 'Где', 'Что случилось', 'Подробности', 'Срочность']);
  expect(screen.queryByRole('button', { name: 'Где' })).toBeNull();
});

test('the edit form has no photos and starts with the place', async () => {
  await renderForm(EMPTY_PROBLEM_DRAFT, { photos: undefined, onCapture: undefined });

  expect(fieldOrder()).toEqual(['Где', 'Что случилось', 'Подробности', 'Срочность']);
  expect(screen.queryByRole('button', { name: 'Снять фото' })).toBeNull();
});

test('the button is pinned under the form, 56 dp, not at the end of what scrolls', async () => {
  await renderForm({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран течёт' });

  const button = screen.getByRole('button', { name: SEND });
  expect((StyleSheet.flatten(button.props.style) as ViewStyle).minHeight).toBe(BUTTON_HEIGHT);
  expect(within(scrollingForm()).getByLabelText('Что случилось')).toBeTruthy();
  expect(within(scrollingForm()).queryByRole('button', { name: SEND })).toBeNull();
});

test('translates a refusal the server sent a key for', async () => {
  await renderForm({ ...EMPTY_PROBLEM_DRAFT, title: 'x' }, { error: REFUSAL });

  expect(screen.getByText('Заголовок длиннее 200 символов')).toBeTruthy();
});

test('the refusal is said next to the button, where she will retry', async () => {
  await renderForm({ ...EMPTY_PROBLEM_DRAFT, title: 'x' }, { error: REFUSAL });

  expect(screen.getByText('Заголовок длиннее 200 символов')).toBeTruthy();
  expect(within(scrollingForm()).queryByText('Заголовок длиннее 200 символов')).toBeNull();
});

test('the button rides above the keyboard, the header counted in', async () => {
  const HEADER = 96;
  await render(
    <HeaderHeightContext.Provider value={HEADER}>
      <ProblemForm
        draft={EMPTY_PROBLEM_DRAFT}
        onChange={jest.fn()}
        place={null}
        isSubmitting={false}
        submitLabel={SEND}
        onSubmit={jest.fn()}
        error={null}
      />
    </HeaderHeightContext.Provider>,
  );

  // Padding on both systems: see the form for why Android is no exception.
  expect(mockAvoidingProps.at(-1)).toEqual(
    expect.objectContaining({ behavior: 'padding', keyboardVerticalOffset: HEADER }),
  );
});
