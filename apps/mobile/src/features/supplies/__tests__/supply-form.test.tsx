import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { Alert, StyleSheet, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, MIN_TOUCH_TARGET } from '@/constants/theme';

import { catalogLine } from '../cart';
import {
  emptySupplyDraft,
  type CatalogItem,
  type SupplyDraft,
  type SupplyItemDraft,
} from '../schema';
import { SupplyForm } from '../supply-form';

/**
 * What she needs, as a cart (owner's variant 1, docs/design/decisions.md §2):
 * the catalogue is the form, each entry with a stepper; manual entry is the
 * last row; a summary with the urgency and «Отправить заявку» is pinned under
 * the list and opens the whole request in a sheet.
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

type FormProps = Parameters<typeof SupplyForm>[0];

const glass: CatalogItem = {
  id: 'c9000002-0000-4000-8000-000000000001',
  name: 'Средство для стёкол',
  name_i18n: { en: 'Glass cleaner' },
  unit: 'l',
  sort_order: 1,
};
const bags: CatalogItem = {
  id: 'c9000002-0000-4000-8000-000000000002',
  name: 'Мешки для мусора',
  name_i18n: {},
  unit: 'pack',
  sort_order: 2,
};
const catalog = [glass, bags];

const SEND = 'Отправить заявку';
const REFUSAL = Object.assign(new Error('The note is longer than 2000 characters'), {
  hint: 'serverErrors.supplyNoteTooLong',
  details: '{"limit": 2000}',
});

function own(key: string, name: string, quantity = '1'): SupplyItemDraft {
  return { key, name, quantity, unit: 'pcs', comment: '', catalogItemId: null };
}

function withItems(...items: SupplyItemDraft[]): SupplyDraft {
  return { ...emptySupplyDraft(), items };
}

async function renderForm(draft: SupplyDraft, overrides: Partial<FormProps> = {}) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  await render(
    <SupplyForm
      draft={draft}
      onChange={onChange}
      newKey={() => 'n1'}
      place={null}
      catalog={catalog}
      isSubmitting={false}
      submitLabel={SEND}
      onSubmit={onSubmit}
      error={null}
      {...overrides}
    />,
  );
  return { onChange, onSubmit };
}

/** What scrolls: the list of the catalogue. */
function scrollingList() {
  const [list] = screen.container.queryAll((node) => node.type === 'RCTScrollView');
  return list;
}

function sizeOf(label: string): ViewStyle {
  return StyleSheet.flatten(screen.getByRole('button', { name: label }).props.style) as ViewStyle;
}

describe('the catalogue is the form', () => {
  test('every entry is a row with its unit and a stepper at zero', async () => {
    await renderForm(emptySupplyDraft());

    expect(screen.getByText('Средство для стёкол')).toBeTruthy();
    expect(screen.getByText('л')).toBeTruthy();
    expect(screen.getByText('Мешки для мусора')).toBeTruthy();
    // Empty with «0» as its hint, not a «0» to delete first: a typed «5» is 5,
    // not «05» (the review of 05.10).
    const idle = screen.getByLabelText('Мешки для мусора: количество');
    expect(idle.props.value).toBe('');
    expect(idle.props.placeholder).toBe('0');
    expect(screen.getByRole('button', { name: 'Мешки для мусора: на одну меньше' })).toBeDisabled();
  });

  test('+ puts the entry into the request, one of it, picked from the catalogue', async () => {
    const { onChange } = await renderForm(emptySupplyDraft());

    await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну больше' }));

    expect(onChange).toHaveBeenCalledWith(withItems(catalogLine('n1', bags, 'ru', '1')));
  });

  test('+ and − step a chosen entry; stepping to zero takes it out of the request', async () => {
    const line = catalogLine('k1', bags, 'ru', '2');
    const { onChange } = await renderForm(withItems(line));

    expect(screen.getByLabelText('Мешки для мусора: количество').props.value).toBe('2');
    await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну больше' }));
    expect(onChange).toHaveBeenLastCalledWith(withItems({ ...line, quantity: '3' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну меньше' }));
    expect(onChange).toHaveBeenLastCalledWith(withItems({ ...line, quantity: '1' }));
  });

  test('one less than one is none', async () => {
    const { onChange } = await renderForm(withItems(catalogLine('k1', bags, 'ru', '1')));

    await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну меньше' }));

    expect(onChange).toHaveBeenCalledWith(withItems());
  });

  // The review of 05.10: a step to zero took her words with the line — the
  // comment, or the name she typed — with no way back. Such a line asks first.
  describe('a line that carries her words asks before it leaves', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** The question's buttons, as the test would press them. */
    function asked(alert: jest.SpyInstance): { text?: string; onPress?: () => void }[] {
      expect(alert).toHaveBeenCalledWith(
        expect.stringMatching(/^Убрать «.+» из заявки\?$/),
        'То, что вы написали к ней, пропадёт.',
        expect.any(Array),
        // A tap beside the question keeps the line, as «Отмена» does.
        expect.objectContaining({ cancelable: true }),
      );
      return alert.mock.calls[0][2] as { text?: string; onPress?: () => void }[];
    }
    const press = (buttons: { text?: string; onPress?: () => void }[], text: string) =>
      buttons.find((button) => button.text === text)?.onPress?.();

    test('a comment: − at one asks, «Убрать» takes it out, «Отмена» keeps it', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const line = { ...catalogLine('k1', bags, 'ru', '1'), comment: 'для кухни' };
      const { onChange } = await renderForm(withItems(line));

      await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну меньше' }));

      expect(onChange).not.toHaveBeenCalled();
      const buttons = asked(alert);
      press(buttons, 'Отмена');
      expect(onChange).not.toHaveBeenCalled();
      press(buttons, 'Убрать');
      expect(onChange).toHaveBeenCalledWith(withItems());
      alert.mockRestore();
    });

    test('a name of her own asks too', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      await renderForm(withItems(own('o1', 'Свечи')));

      await fireEvent.press(screen.getByRole('button', { name: 'Свечи: на одну меньше' }));

      expect(alert.mock.calls[0][0]).toBe('Убрать «Свечи» из заявки?');
      alert.mockRestore();
    });

    test('a field left at zero asks, and «Отмена» brings the line back to one', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const line = { ...catalogLine('k1', glass, 'ru', '0'), comment: 'для окон' };
      const { onChange } = await renderForm(withItems(line));

      await fireEvent(screen.getByLabelText('Средство для стёкол: количество'), 'blur');

      press(asked(alert), 'Отмена');
      expect(onChange).toHaveBeenCalledWith(withItems({ ...line, quantity: '1' }));
      alert.mockRestore();
    });
  });

  test('the number is typed too, decimals as before; typing on a row at zero starts its line', async () => {
    const { onChange } = await renderForm(emptySupplyDraft());

    await fireEvent.changeText(screen.getByLabelText('Средство для стёкол: количество'), '1,5');

    expect(onChange).toHaveBeenCalledWith(withItems(catalogLine('n1', glass, 'ru', '1,5')));
  });

  test('what she types into a chosen row is its quantity, as typed', async () => {
    const line = catalogLine('k1', glass, 'ru', '1');
    const { onChange } = await renderForm(withItems(line));

    await fireEvent.changeText(screen.getByLabelText('Средство для стёкол: количество'), '2,25');

    expect(onChange).toHaveBeenCalledWith(withItems({ ...line, quantity: '2,25' }));
  });

  test.each(['', '0'])('a field left at «%s» takes the line out of the request', async (typed) => {
    const line = catalogLine('k1', glass, 'ru', typed);
    const { onChange } = await renderForm(withItems(line));

    await fireEvent(screen.getByLabelText('Средство для стёкол: количество'), 'blur');

    expect(onChange).toHaveBeenCalledWith(withItems());
  });

  test('a quantity that is not a number stays, and the old rule greys the button and says why', async () => {
    const line = catalogLine('k1', glass, 'ru', 'abc');
    const { onChange } = await renderForm(withItems(line));

    await fireEvent(screen.getByLabelText('Средство для стёкол: количество'), 'blur');

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('У каждой позиции нужны название и количество больше нуля'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: SEND })).toBeDisabled();
  });

  test('the steppers are a finger wide: at least 48 dp each way', async () => {
    await renderForm(withItems(catalogLine('k1', bags, 'ru', '2')));

    for (const label of ['Мешки для мусора: на одну меньше', 'Мешки для мусора: на одну больше']) {
      expect(sizeOf(label).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(sizeOf(label).minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
    const field = StyleSheet.flatten(
      screen.getByLabelText('Мешки для мусора: количество').props.style,
    ) as ViewStyle;
    expect(field.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(field.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test('shows where the supplies are for', async () => {
    await renderForm(emptySupplyDraft(), { place: 'CZ - Nadrazni Apt 6' });

    expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  });
});

describe('the search', () => {
  test('narrows the catalogue, case and diacritics aside', async () => {
    await renderForm(emptySupplyDraft());

    await fireEvent.changeText(screen.getByLabelText('Поиск по списку'), 'СТЕКОЛ');

    expect(screen.getByText('Средство для стёкол')).toBeTruthy();
    expect(screen.queryByText('Мешки для мусора')).toBeNull();
  });

  test('finds an entry by its name in another language', async () => {
    await renderForm(emptySupplyDraft());

    await fireEvent.changeText(screen.getByLabelText('Поиск по списку'), 'glass');

    expect(screen.getByText('Средство для стёкол')).toBeTruthy();
  });

  test('says when nothing matches, and manual entry stays at the end', async () => {
    await renderForm(emptySupplyDraft());

    await fireEvent.changeText(screen.getByLabelText('Поиск по списку'), 'губки');

    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Нет в списке — ввести вручную' })).toBeTruthy();
  });
});

describe('manual entry', () => {
  async function openManual() {
    await fireEvent.press(screen.getByRole('button', { name: 'Нет в списке — ввести вручную' }));
    return within(screen.getByTestId('supply-line-sheet'));
  }

  test('the last row opens a sheet with the name, the unit and the quantity; «Добавить» puts the line in', async () => {
    const { onChange } = await renderForm(emptySupplyDraft());

    const sheet = await openManual();
    await fireEvent.changeText(sheet.getByLabelText('Название'), 'Губки');
    await fireEvent.press(sheet.getByRole('radio', { name: 'упак' }));
    await fireEvent.changeText(sheet.getByLabelText('Количество'), '3');
    await fireEvent.press(sheet.getByRole('button', { name: 'Добавить' }));

    expect(onChange).toHaveBeenCalledWith(
      withItems({
        key: 'n1',
        name: 'Губки',
        quantity: '3',
        unit: 'pack',
        comment: '',
        catalogItemId: null,
      }),
    );
    expect(screen.queryByTestId('supply-line-sheet')).toBeNull();
  });

  test('«Добавить» stays grey until the line has a name and a quantity above zero', async () => {
    const { onChange } = await renderForm(emptySupplyDraft());

    const sheet = await openManual();
    expect(sheet.getByRole('button', { name: 'Добавить' })).toBeDisabled();
    await fireEvent.changeText(sheet.getByLabelText('Название'), 'Губки');
    expect(sheet.getByRole('button', { name: 'Добавить' })).toBeEnabled();
    await fireEvent.changeText(sheet.getByLabelText('Количество'), '0');
    await fireEvent.press(sheet.getByRole('button', { name: 'Добавить' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('starts from what she searched for', async () => {
    await renderForm(emptySupplyDraft());

    await fireEvent.changeText(screen.getByLabelText('Поиск по списку'), 'Губки ');
    const sheet = await openManual();

    expect(sheet.getByLabelText('Название').props.value).toBe('Губки');
    expect(sheet.getByLabelText('Количество').props.value).toBe('1');
  });

  test('her own line stands above the catalogue, with its stepper, and leaves at zero', async () => {
    // Her own name is her words: the line asks first, and «Убрать» takes it out.
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) =>
      buttons?.find((button) => button.text === 'Убрать')?.onPress?.(),
    );
    const { onChange } = await renderForm(withItems(own('k1', 'Губки')));

    const names = screen.getAllByText(/^(Губки|Средство для стёкол|Мешки для мусора)$/);
    expect(names.map((node) => String(node.props.children))).toEqual([
      'Губки',
      'Средство для стёкол',
      'Мешки для мусора',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Губки: на одну меньше' }));

    expect(onChange).toHaveBeenCalledWith(withItems());
    alert.mockRestore();
  });

  test('her own line opens in the sheet to be changed', async () => {
    const line = own('k1', 'Губки', '2');
    const { onChange } = await renderForm(withItems(line));

    await fireEvent.press(screen.getByRole('button', { name: 'Губки: изменить' }));
    const sheet = within(screen.getByTestId('supply-line-sheet'));
    expect(sheet.getByLabelText('Количество').props.value).toBe('2');
    await fireEvent.changeText(sheet.getByLabelText('Название'), 'Губки для посуды');
    await fireEvent.press(sheet.getByRole('button', { name: 'Сохранить' }));

    expect(onChange).toHaveBeenCalledWith(withItems({ ...line, name: 'Губки для посуды' }));
  });

  test('«Закрыть» adds nothing', async () => {
    const { onChange } = await renderForm(emptySupplyDraft());

    const sheet = await openManual();
    await fireEvent.changeText(sheet.getByLabelText('Название'), 'Губки');
    await fireEvent.press(sheet.getByRole('button', { name: 'Закрыть' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('supply-line-sheet')).toBeNull();
  });

  test('without a catalogue she types every line: no search, and the row says add', async () => {
    const { onChange } = await renderForm(emptySupplyDraft(), { catalog: [] });

    expect(screen.queryByLabelText('Поиск по списку')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '+ Добавить позицию' }));
    const sheet = within(screen.getByTestId('supply-line-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Название'), 'Мешки');
    await fireEvent.press(sheet.getByRole('button', { name: 'Добавить' }));

    expect(onChange).toHaveBeenCalledWith(withItems(own('n1', 'Мешки')));
  });
});

describe('the summary under the list', () => {
  test.each([
    [1, '1 позиция'],
    [2, '2 позиции'],
    [5, '5 позиций'],
  ])('counts %i chosen lines as «%s»', async (count, text) => {
    const lines = Array.from({ length: count }, (_, index) => own(`k${index}`, `Позиция ${index}`));
    await renderForm(withItems(...lines));

    expect(screen.getByRole('button', { name: text })).toBeTruthy();
  });

  test('switches the urgency, as before', async () => {
    const draft = emptySupplyDraft();
    const { onChange } = await renderForm(draft);

    expect(screen.getByRole('radio', { name: 'Обычная' })).toBeSelected();
    await fireEvent.press(screen.getByRole('radio', { name: 'Срочно' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, priority: 'urgent' });
  });

  test('keeps the button grey until a line is chosen', async () => {
    const { onSubmit } = await renderForm(emptySupplyDraft());

    const button = screen.getByRole('button', { name: SEND });
    expect(button).toBeDisabled();
    await fireEvent.press(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('sends once a line has a quantity', async () => {
    const { onSubmit } = await renderForm(withItems(catalogLine('k1', bags, 'ru', '2')));

    await fireEvent.press(screen.getByRole('button', { name: SEND }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('the button is 56 dp, pinned under the list, not at the end of what scrolls', async () => {
    await renderForm(withItems(catalogLine('k1', bags, 'ru', '2')));

    expect(sizeOf(SEND).minHeight).toBe(BUTTON_HEIGHT);
    expect(within(scrollingList()).getByText('Мешки для мусора')).toBeTruthy();
    expect(within(scrollingList()).queryByRole('button', { name: SEND })).toBeNull();
    expect(within(scrollingList()).queryByRole('button', { name: '1 позиция' })).toBeNull();
  });

  test('while it goes, the button is busy and nothing can be changed', async () => {
    const { onSubmit, onChange } = await renderForm(withItems(catalogLine('k1', bags, 'ru', '2')), {
      isSubmitting: true,
    });

    expect(screen.getByRole('button', { name: SEND })).toBeBusy();
    await fireEvent.press(screen.getByRole('button', { name: SEND }));
    await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну больше' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a refusal is said next to the button, where she will retry', async () => {
    await renderForm(withItems(catalogLine('k1', bags, 'ru', '2')), { error: REFUSAL });

    expect(screen.getByText('Комментарий длиннее 2000 символов')).toBeTruthy();
    expect(within(scrollingList()).queryByText('Комментарий длиннее 2000 символов')).toBeNull();
  });

  test('the button rides above the keyboard, the header counted in', async () => {
    const HEADER = 96;
    await render(
      <HeaderHeightContext.Provider value={HEADER}>
        <SupplyForm
          draft={emptySupplyDraft()}
          onChange={jest.fn()}
          newKey={() => 'n1'}
          place={null}
          catalog={catalog}
          isSubmitting={false}
          submitLabel={SEND}
          onSubmit={jest.fn()}
          error={null}
        />
      </HeaderHeightContext.Provider>,
    );

    expect(mockAvoidingProps.at(-1)).toEqual(
      expect.objectContaining({ behavior: 'padding', keyboardVerticalOffset: HEADER }),
    );
  });
});

describe('the request sheet', () => {
  async function openRequest(count: string) {
    await fireEvent.press(screen.getByRole('button', { name: count }));
    return within(screen.getByTestId('supply-request-sheet'));
  }

  test('a tap on the summary shows the chosen lines with their quantities', async () => {
    await renderForm(withItems(catalogLine('k1', bags, 'ru', '2'), own('k2', 'Губки', '3')));

    const sheet = await openRequest('2 позиции');

    expect(sheet.getByRole('header', { name: 'Заявка' })).toBeTruthy();
    expect(sheet.getByText('Мешки для мусора')).toBeTruthy();
    expect(sheet.getByLabelText('Мешки для мусора: количество').props.value).toBe('2');
    expect(sheet.getByLabelText('Губки: количество').props.value).toBe('3');
    expect(sheet.queryByText('Средство для стёкол')).toBeNull();
  });

  test('each line has its comment, the old «уточнение»', async () => {
    const line = catalogLine('k1', bags, 'ru', '2');
    const { onChange } = await renderForm(withItems(line));

    const sheet = await openRequest('1 позиция');
    await fireEvent.changeText(sheet.getByLabelText('Мешки для мусора: уточнение'), '60 л');

    expect(onChange).toHaveBeenCalledWith(withItems({ ...line, comment: '60 л' }));
  });

  test('the note is there, as before', async () => {
    const draft = withItems(catalogLine('k1', bags, 'ru', '2'));
    const { onChange } = await renderForm(draft);

    const sheet = await openRequest('1 позиция');
    await fireEvent.changeText(sheet.getByLabelText('Комментарий'), 'Оставить у двери');

    expect(onChange).toHaveBeenCalledWith({ ...draft, note: 'Оставить у двери' });
  });

  test('urgency is explained in words there, and chosen there too', async () => {
    const draft = withItems(catalogLine('k1', bags, 'ru', '2'));
    const { onChange } = await renderForm(draft);

    const sheet = await openRequest('1 позиция');
    expect(sheet.getByText('Срочно — заканчивается сейчас, без этого не убрать')).toBeTruthy();
    await fireEvent.press(sheet.getByRole('radio', { name: 'Срочно' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, priority: 'urgent' });
  });

  test('a line stepped to zero there leaves the request', async () => {
    const { onChange } = await renderForm(withItems(catalogLine('k1', bags, 'ru', '1')));

    const sheet = await openRequest('1 позиция');
    await fireEvent.press(sheet.getByRole('button', { name: 'Мешки для мусора: на одну меньше' }));

    expect(onChange).toHaveBeenCalledWith(withItems());
  });

  test('an empty cart says where to choose from', async () => {
    await renderForm(emptySupplyDraft());

    const sheet = await openRequest('0 позиций');

    expect(sheet.getByText('Позиций пока нет — выберите их в списке')).toBeTruthy();
  });
});
