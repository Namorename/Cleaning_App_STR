import { fireEvent, render, screen } from '@testing-library/react-native';

import { emptySupplyDraft, type SupplyDraft } from '../schema';
import { SupplyForm } from '../supply-form';

async function renderForm(draft: SupplyDraft) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  const onAddItem = jest.fn();
  await render(
    <SupplyForm
      draft={draft}
      onChange={onChange}
      onAddItem={onAddItem}
      place={null}
      isSubmitting={false}
      submitLabel="Отправить заявку"
      onSubmit={onSubmit}
      error={null}
    />,
  );
  return { onChange, onSubmit, onAddItem };
}

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
