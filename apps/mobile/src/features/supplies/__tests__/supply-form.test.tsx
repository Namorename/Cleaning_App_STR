import { fireEvent, render, screen } from '@testing-library/react-native';

import { emptySupplyDraft, type CatalogItem, type SupplyDraft } from '../schema';
import { SupplyForm } from '../supply-form';

const catalog: CatalogItem[] = [
  {
    id: 'c9000002-0000-4000-8000-000000000001',
    name: 'Средство для стёкол',
    name_i18n: { en: 'Glass cleaner' },
    unit: 'l',
    sort_order: 1,
  },
  {
    id: 'c9000002-0000-4000-8000-000000000002',
    name: 'Мешки для мусора',
    name_i18n: {},
    unit: 'pack',
    sort_order: 2,
  },
];

async function renderForm(draft: SupplyDraft, list: CatalogItem[] = []) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  const onAddItem = jest.fn();
  await render(
    <SupplyForm
      draft={draft}
      onChange={onChange}
      onAddItem={onAddItem}
      place={null}
      catalog={list}
      isSubmitting={false}
      submitLabel="Отправить заявку"
      onSubmit={onSubmit}
      error={null}
    />,
  );
  return { onChange, onSubmit, onAddItem };
}

test('with a catalogue a line is picked from the list and only the quantity is typed', async () => {
  const draft = emptySupplyDraft('k1');
  const { onChange } = await renderForm(draft, catalog);

  expect(screen.queryByLabelText('Позиция 1: название')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'упак' })).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Позиция 1: выбрать из списка' }));
  await fireEvent.changeText(screen.getByLabelText('Поиск по списку'), 'меш');
  expect(screen.queryByRole('button', { name: 'Средство для стёкол, л' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора, упак' }));

  expect(onChange).toHaveBeenCalledWith({
    ...draft,
    items: [
      {
        ...draft.items[0],
        name: 'Мешки для мусора',
        unit: 'pack',
        catalogItemId: 'c9000002-0000-4000-8000-000000000002',
      },
    ],
  });
});

test('a picked line shows its name and unit, and typing stays one tap away', async () => {
  const draft = emptySupplyDraft('k1');
  const picked = {
    ...draft,
    items: [
      {
        ...draft.items[0],
        name: 'Средство для стёкол',
        unit: 'l' as const,
        catalogItemId: 'c9000002-0000-4000-8000-000000000001',
      },
    ],
  };
  const { onChange } = await renderForm(picked, catalog);

  expect(screen.getByText('Средство для стёкол')).toBeTruthy();
  expect(screen.getByText('л')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Нет в списке — ввести вручную' }));

  expect(onChange).toHaveBeenCalledWith({
    ...picked,
    items: [{ ...picked.items[0], name: '', catalogItemId: null }],
  });
  expect(screen.getByLabelText('Позиция 1: название')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Выбрать из списка вместо ввода' })).toBeTruthy();
});

test('keeps the button grey until a line is filled in', async () => {
  const { onSubmit } = await renderForm(emptySupplyDraft('k1'));

  const button = screen.getByRole('button', { name: 'Отправить заявку' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);

  expect(onSubmit).not.toHaveBeenCalled();
});

test('sends once a line has a name and a quantity', async () => {
  const draft = emptySupplyDraft('k1');
  const { onSubmit } = await renderForm({
    ...draft,
    items: [{ ...draft.items[0], name: 'Мешки', quantity: '2' }],
  });

  await fireEvent.press(screen.getByRole('button', { name: 'Отправить заявку' }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('hands a typed name back inside the draft', async () => {
  const draft = emptySupplyDraft('k1');
  const { onChange } = await renderForm(draft);

  await fireEvent.changeText(screen.getByLabelText('Позиция 1: название'), 'Мешки');

  expect(onChange).toHaveBeenCalledWith({
    ...draft,
    items: [{ ...draft.items[0], name: 'Мешки' }],
  });
});

test('lets her switch the unit of a line', async () => {
  const draft = emptySupplyDraft('k1');
  const { onChange } = await renderForm(draft);

  await fireEvent.press(screen.getByRole('radio', { name: 'упак' }));

  expect(onChange).toHaveBeenCalledWith({
    ...draft,
    items: [{ ...draft.items[0], unit: 'pack' }],
  });
});

test('explains urgency in words and reports the choice', async () => {
  const draft = emptySupplyDraft('k1');
  const { onChange } = await renderForm(draft);

  expect(screen.getByText('Срочно — заканчивается сейчас, без этого не убрать')).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Срочно' }));

  expect(onChange).toHaveBeenCalledWith({ ...draft, priority: 'urgent' });
});

test('adds a line on request and removes one when there are two', async () => {
  const draft = emptySupplyDraft('k1');
  const two = { ...draft, items: [draft.items[0], { ...draft.items[0], key: 'k2' }] };
  const { onChange, onAddItem } = await renderForm(two);

  await fireEvent.press(screen.getByRole('button', { name: '+ Добавить позицию' }));
  expect(onAddItem).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getAllByRole('button', { name: 'Убрать позицию' })[0]);
  expect(onChange).toHaveBeenCalledWith({ ...two, items: [two.items[1]] });
});
