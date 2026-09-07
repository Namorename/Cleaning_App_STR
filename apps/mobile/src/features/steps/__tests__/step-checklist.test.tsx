import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ChecklistModuleView } from '../schema';
import { StepChecklist } from '../step-checklist';

const modules: ChecklistModuleView[] = [
  {
    id: 'm1',
    title: 'Ванная',
    title_i18n: {},
    items: [
      { id: 'i1', title: 'Зеркало', title_i18n: {}, is_optional: false },
      { id: 'i2', title: 'Балкон', title_i18n: {}, is_optional: true },
    ],
  },
  {
    id: 'm2',
    title: 'Кухня',
    title_i18n: {},
    items: [{ id: 'i3', title: 'Плита', title_i18n: {}, is_optional: false }],
  },
];

/** A checklist a Czech manager wrote, translated into the reader's language. */
const translated: ChecklistModuleView[] = [
  {
    id: 'm1',
    title: 'Koupelna',
    title_i18n: { ru: 'Ванная', en: 'Bathroom' },
    items: [
      { id: 'i1', title: 'Zrcadlo', title_i18n: { ru: 'Зеркало' }, is_optional: false },
      { id: 'i2', title: 'Ručníky', title_i18n: {}, is_optional: false },
    ],
  },
];

const onToggle = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows every module as a heading with its items under it', async () => {
  await render(
    <StepChecklist modules={modules} checked={[]} onToggle={onToggle} disabled={false} />,
  );

  expect(screen.getByRole('header', { name: 'Ванная' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Кухня' })).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});

test('says which item may be left alone', async () => {
  await render(
    <StepChecklist modules={modules} checked={[]} onToggle={onToggle} disabled={false} />,
  );

  // The cleaner has to be able to tell an optional item apart, otherwise she
  // ticks it out of caution and the checklist stops meaning anything.
  expect(screen.getByText('Необязательный пункт')).toBeTruthy();
});

test('reports the item that was tapped', async () => {
  await render(
    <StepChecklist modules={modules} checked={[]} onToggle={onToggle} disabled={false} />,
  );

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Плита' }));

  expect(onToggle).toHaveBeenCalledWith('i3');
});

test('shows what is already ticked', async () => {
  await render(
    <StepChecklist modules={modules} checked={['i1']} onToggle={onToggle} disabled={false} />,
  );

  expect(screen.getByRole('checkbox', { name: 'Зеркало' }).props.accessibilityState.checked).toBe(
    true,
  );
  expect(screen.getByRole('checkbox', { name: 'Плита' }).props.accessibilityState.checked).toBe(
    false,
  );
});

test('accepts no taps while the step is read-only', async () => {
  await render(<StepChecklist modules={modules} checked={[]} onToggle={onToggle} disabled />);

  await fireEvent.press(screen.getByRole('checkbox', { name: 'Зеркало' }));

  expect(onToggle).not.toHaveBeenCalled();
});

test('reads names in the language of the cleaner when there is a translation', async () => {
  await render(
    <StepChecklist modules={translated} checked={[]} onToggle={onToggle} disabled={false} />,
  );

  expect(screen.getByRole('header', { name: 'Ванная' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Зеркало' })).toBeTruthy();
});

test('falls back to what the manager wrote when her language is missing', async () => {
  await render(
    <StepChecklist modules={translated} checked={[]} onToggle={onToggle} disabled={false} />,
  );

  // Nobody translated this one: better the Czech original than a blank line.
  expect(screen.getByRole('checkbox', { name: 'Ručníky' })).toBeTruthy();
});

test('a step whose checklist came out empty says so instead of showing nothing', async () => {
  await render(<StepChecklist modules={[]} checked={[]} onToggle={onToggle} disabled={false} />);

  expect(screen.getByText('Чек-лист пуст')).toBeTruthy();
});
