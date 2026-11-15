import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import type { ProblemCategory } from '../categories';
import { ProblemForm } from '../problem-form';
import { EMPTY_PROBLEM_DRAFT, type ProblemDraft } from '../schema';

/**
 * The form of a company that reports by catalogue (hosts.problem_report_mode =
 * catalog, CLIENT:Wagnerstays): a category picked from a searchable list in
 * place of the typed title, its urgency shown beside it and never chosen, the
 * details typed as before. Without the catalogue the form is the one every
 * company had (problem-form.test.tsx).
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => false }));

const CATEGORIES: ProblemCategory[] = [
  {
    id: '83ffda56-635c-4941-bedd-cb08b82e6675',
    name: 'Горячая вода',
    name_i18n: { en: 'Hot water', cs: 'Teplá voda' },
    synonyms: ['бойлер'],
    priority: 'high',
  },
  {
    id: '37659104-f5d6-4596-bb00-01130bc371cb',
    name: 'Электричество полностью',
    name_i18n: { en: 'Total power outage', cs: 'Úplný výpadek elektřiny' },
    synonyms: ['свет'],
    priority: 'high',
  },
  {
    id: '46d47fc5-72f2-46f7-a63c-2a7227dd6aca',
    name: 'Частичное отсутствие электричества',
    name_i18n: { en: 'Partial power outage', cs: 'Částečný výpadek elektřiny' },
    synonyms: ['свет', 'розетка'],
    priority: 'normal',
  },
  {
    id: '7bed8f05-ae67-43c3-82d5-01bf1b4a26c6',
    name: 'Смесители',
    name_i18n: { en: 'Taps', cs: 'Vodovodní baterie' },
    synonyms: ['кран', 'смеситель'],
    priority: 'normal',
  },
  {
    id: '0e170fe9-4973-48fb-bc0b-23f548340527',
    name: 'Декор',
    name_i18n: { en: 'Decor', cs: 'Dekorace' },
    synonyms: [],
    priority: 'low',
  },
];
const [HOT_WATER, , , TAPS] = CATEGORIES;

const SEND = 'Отправить';

interface HarnessProps {
  initial: ProblemDraft;
  categories: readonly ProblemCategory[] | null;
  onSubmit?: (draft: ProblemDraft) => void;
}

/** The form with its draft in state, as the routes hold it. */
function Harness({ initial, categories, onSubmit = jest.fn() }: HarnessProps) {
  const [draft, setDraft] = useState(initial);
  return (
    <ProblemForm
      draft={draft}
      onChange={setDraft}
      categories={categories}
      place="CZ - Nadrazni Apt 6"
      photos={[]}
      onCapture={jest.fn()}
      isSubmitting={false}
      submitLabel={SEND}
      onSubmit={() => onSubmit(draft)}
      error={null}
    />
  );
}

async function openCategories(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Категория' }));
}

describe('a company that reports by catalogue', () => {
  test('asks for a category instead of a title, and no urgency to choose', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} />);

    expect(screen.getByRole('button', { name: 'Категория' })).toHaveAccessibilityValue({
      text: 'Выберите категорию',
    });
    expect(screen.queryByLabelText('Что случилось')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByLabelText('Подробности')).toBeTruthy();
  });

  test('keeps the button grey until a category is picked', async () => {
    const onSubmit = jest.fn();
    await render(
      <Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} onSubmit={onSubmit} />,
    );

    const button = screen.getByRole('button', { name: SEND });
    expect(button).toBeDisabled();
    await fireEvent.press(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('the list carries every category with its urgency, word and all', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} />);
    await openCategories();

    expect(screen.getByRole('button', { name: 'Горячая вода, срочность: Высокая' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Смесители, срочность: Обычная' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Декор, срочность: Низкая' })).toBeTruthy();
    const row = screen.getByRole('button', { name: 'Горячая вода, срочность: Высокая' });
    expect(within(row).getByText('Высокая')).toBeTruthy();
  });

  test('the first letters narrow the list at once', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} />);
    await openCategories();

    await fireEvent.changeText(screen.getByLabelText('Начните вводить название категории'), 'элек');

    expect(screen.getByText('Электричество полностью')).toBeTruthy();
    expect(screen.getByText('Частичное отсутствие электричества')).toBeTruthy();
    expect(screen.queryByText('Горячая вода')).toBeNull();
    expect(screen.queryByText('Смесители')).toBeNull();
  });

  test('a synonym finds its category', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} />);
    await openCategories();

    await fireEvent.changeText(screen.getByLabelText('Начните вводить название категории'), 'кран');

    expect(screen.getByText('Смесители')).toBeTruthy();
    expect(screen.queryByText('Горячая вода')).toBeNull();
  });

  test('says so when nothing matches', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} />);
    await openCategories();

    await fireEvent.changeText(screen.getByLabelText('Начните вводить название категории'), 'zzz');

    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  });

  test('a pick sets the category and its urgency, shown and not offered', async () => {
    const onSubmit = jest.fn();
    await render(
      <Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} onSubmit={onSubmit} />,
    );
    await openCategories();
    await fireEvent.press(screen.getByRole('button', { name: 'Горячая вода, срочность: Высокая' }));

    expect(screen.getByRole('button', { name: 'Категория' })).toHaveAccessibilityValue({
      text: 'Горячая вода',
    });
    const urgency = screen.getByTestId('problem-category-priority');
    expect(within(urgency).getByText('Высокая')).toBeTruthy();
    expect(within(urgency).getByText('Срочность задаётся категорией')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Подробности'), 'Нет воды на кухне');
    await fireEvent.press(screen.getByRole('button', { name: SEND }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Горячая вода',
      description: 'Нет воды на кухне',
      priority: 'high',
      categoryId: HOT_WATER.id,
    });
  });

  test('another pick moves the urgency with it', async () => {
    const onSubmit = jest.fn();
    await render(
      <Harness initial={EMPTY_PROBLEM_DRAFT} categories={CATEGORIES} onSubmit={onSubmit} />,
    );
    await openCategories();
    await fireEvent.press(screen.getByRole('button', { name: 'Горячая вода, срочность: Высокая' }));
    await openCategories();
    await fireEvent.press(screen.getByRole('button', { name: 'Смесители, срочность: Обычная' }));
    await fireEvent.press(screen.getByRole('button', { name: SEND }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Смесители', priority: 'normal', categoryId: TAPS.id }),
    );
  });

  test('a report filed under a category that is no longer offered keeps its name and urgency', async () => {
    const filed: ProblemDraft = {
      title: 'Кондиционер',
      description: '',
      priority: 'normal',
      categoryId: 'bacca1bc-6f84-4c28-87f7-78f703bada4d',
    };
    await render(<Harness initial={filed} categories={null} />);

    expect(screen.getByRole('button', { name: 'Категория' })).toHaveAccessibilityValue({
      text: 'Кондиционер',
    });
    expect(
      within(screen.getByTestId('problem-category-priority')).getByText('Обычная'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Что случилось')).toBeNull();
    // Nothing to pick from on this phone: the field names the category and does not open.
    expect(screen.getByRole('button', { name: 'Категория' })).toBeDisabled();
  });
});

describe('the typed title stays where the catalogue is not', () => {
  test('a company that types titles: the form every company had', async () => {
    await render(<Harness initial={EMPTY_PROBLEM_DRAFT} categories={null} />);

    expect(screen.getByLabelText('Что случилось')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Категория' })).toBeNull();
  });

  test('a title she typed and emptied again keeps the typed form', async () => {
    const LateCatalogue = () => {
      const [arrived, setArrived] = useState(false);
      return (
        <>
          <Harness initial={EMPTY_PROBLEM_DRAFT} categories={arrived ? CATEGORIES : null} />
          <Pressable accessibilityRole="button" onPress={() => setArrived(true)}>
            <Text>arrive</Text>
          </Pressable>
        </>
      );
    };
    await render(<LateCatalogue />);

    await fireEvent.changeText(screen.getByLabelText('Что случилось'), 'Н');
    await fireEvent.changeText(screen.getByLabelText('Что случилось'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'arrive' }));

    expect(screen.getByLabelText('Что случилось')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Категория' })).toBeNull();
  });

  test("a catalogue that arrives before she typed anything takes the title's place", async () => {
    const LateCatalogue = () => {
      const [arrived, setArrived] = useState(false);
      return (
        <>
          <Harness initial={EMPTY_PROBLEM_DRAFT} categories={arrived ? CATEGORIES : null} />
          <Pressable accessibilityRole="button" onPress={() => setArrived(true)}>
            <Text>arrive</Text>
          </Pressable>
        </>
      );
    };
    await render(<LateCatalogue />);
    expect(screen.getByLabelText('Что случилось')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'arrive' }));

    expect(screen.queryByLabelText('Что случилось')).toBeNull();
    expect(screen.getByRole('button', { name: 'Категория' })).toBeTruthy();
  });

  test('a title typed before the catalogue arrived is kept, and so is the form', async () => {
    const typed = { ...EMPTY_PROBLEM_DRAFT, title: 'Нет воды' };
    await render(<Harness initial={typed} categories={CATEGORIES} />);

    expect(screen.getByLabelText('Что случилось')).toHaveDisplayValue('Нет воды');
    expect(screen.queryByRole('button', { name: 'Категория' })).toBeNull();
    expect(screen.getByRole('button', { name: SEND })).toBeEnabled();
  });
});
