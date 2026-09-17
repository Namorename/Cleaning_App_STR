import { fireEvent, render, screen } from '@testing-library/react-native';

import { PropertyPicker } from '../property-picker';
import type { ReportProperty } from '../schema';

/**
 * A report filed from the list of problems used to carry no place at all, and
 * three of the four reports on the live database have neither a place nor a
 * task. This is the control that fixes that, so what it has to get right is
 * the label a manager will read and the fact that only her own places are in
 * it — the list itself comes from a view that decides that on the server.
 *
 * Tests read Russian: that is the language jest.setup fixes for the app.
 */

const place = (id: number, name: string, parentName: string | null = null): ReportProperty => ({
  id,
  name,
  parent_id: parentName === null ? null : 1,
  hostaway_unit_id: parentName === null ? null : id,
  parent_name: parentName,
});

const twoPlaces = [place(1, 'Nadrazni 6'), place(2, '1 - 2109', 'Vinohradska Royal')];

test('asks her to choose while nothing is chosen', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  expect(screen.getByText('Выберите объект')).toBeTruthy();
});

test('opens the list on a tap and names a room after its house', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  await fireEvent.press(screen.getByLabelText('Где'));

  expect(screen.getByText('Vinohradska Royal — 1 - 2109')).toBeTruthy();
});

test('hands back the place she picked and folds away again', async () => {
  const onSelect = jest.fn();
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={onSelect} />);

  await fireEvent.press(screen.getByLabelText('Где'));
  await fireEvent.press(screen.getByText('Nadrazni 6'));

  expect(onSelect).toHaveBeenCalledWith(1);
  expect(screen.queryByText('Vinohradska Royal — 1 - 2109')).toBeNull();
});

test('shows the chosen place instead of the invitation', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={1} onSelect={jest.fn()} />);

  expect(screen.getByText('Nadrazni 6')).toBeTruthy();
  expect(screen.queryByText('Выберите объект')).toBeNull();
});

test('a short list is offered without a search box in the way', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  await fireEvent.press(screen.getByLabelText('Где'));

  expect(screen.queryByLabelText('Поиск объектов')).toBeNull();
});

test('a long list gets a search box, and it narrows by any word', async () => {
  const many = Array.from({ length: 9 }, (_, index) => place(index + 1, `Flat ${index + 1}`));
  await render(<PropertyPicker properties={many} selectedId={null} onSelect={jest.fn()} />);

  await fireEvent.press(screen.getByLabelText('Где'));
  await fireEvent.changeText(screen.getByLabelText('Поиск объектов'), 'flat 7');

  expect(screen.getByText('Flat 7')).toBeTruthy();
  expect(screen.queryByText('Flat 1')).toBeNull();
});

test('a cleaner linked to nothing is told so, not left staring at a blank', async () => {
  await render(<PropertyPicker properties={[]} selectedId={null} onSelect={jest.fn()} />);

  await fireEvent.press(screen.getByLabelText('Где'));

  expect(screen.getByText('За вами пока не закреплён ни один объект')).toBeTruthy();
});

test('while the list is on its way it says so rather than claiming there is none', async () => {
  await render(<PropertyPicker properties={[]} selectedId={null} onSelect={jest.fn()} isLoading />);

  expect(screen.getByText('Загружаем объекты…')).toBeTruthy();
});
