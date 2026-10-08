import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';

import { PropertyPicker } from '../property-picker';
import type { ReportProperty } from '../schema';

/**
 * A report filed from the list of reports used to carry no place at all, and
 * three of the four reports on the live database have neither a place nor a
 * task. This is the control that fixes that, so what it has to get right is
 * the label a manager will read and the fact that only her own places are in
 * it — the list itself comes from a view that decides that on the server.
 *
 * It is a field that opens a sheet from the bottom (owner's variant 1): the
 * list used to unfold inside the form, thirty rows for a cleaner with thirty
 * rooms (docs/design/redesign-directions.html, `pproblems`).
 *
 * Tests read Russian: that is the language jest.setup fixes for the app.
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => false }));

const place = (id: number, name: string, parentName: string | null = null): ReportProperty => ({
  id,
  name,
  parent_id: parentName === null ? null : 1,
  hostaway_unit_id: parentName === null ? null : id,
  parent_name: parentName,
});

const twoPlaces = [place(1, 'Nadrazni 6'), place(2, '1 - 2109', 'Vinohradska Royal')];

/** Long enough for the search box. */
const manyPlaces = Array.from({ length: 9 }, (_, index) => place(index + 1, `Flat ${index + 1}`));

const FIELD = { name: 'Где' } as const;

async function openSheet(): Promise<void> {
  await fireEvent.press(screen.getByRole('button', FIELD));
}

test('asks her to choose while nothing is chosen', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  expect(screen.getByText('Выберите объект')).toBeTruthy();
});

test('the place is a field she can hit with a gloved finger', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  const field = StyleSheet.flatten(screen.getByRole('button', FIELD).props.style) as ViewStyle;
  expect(field.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
});

test('a tap opens a sheet titled like the field, a room named after its house', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();

  expect(screen.getByRole('header', { name: 'Где' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Vinohradska Royal — 1 - 2109' })).toBeTruthy();
});

test('hands back the place she picked and closes the sheet', async () => {
  const onSelect = jest.fn();
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={onSelect} />);

  await openSheet();
  await fireEvent.press(screen.getByRole('button', { name: 'Nadrazni 6' }));

  expect(onSelect).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('header', { name: 'Где' })).toBeNull();
});

test('closing the sheet chooses nothing', async () => {
  const onSelect = jest.fn();
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={onSelect} />);

  await openSheet();
  await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));

  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('header', { name: 'Где' })).toBeNull();
  expect(screen.getByText('Выберите объект')).toBeTruthy();
});

test('shows the chosen place instead of the invitation, and marks it in the sheet', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={1} onSelect={jest.fn()} />);

  expect(screen.getByText('Nadrazni 6')).toBeTruthy();
  expect(screen.queryByText('Выберите объект')).toBeNull();

  await openSheet();

  expect(screen.getByRole('button', { name: 'Nadrazni 6' })).toBeSelected();
});

test('a short list is offered without a search box in the way', async () => {
  await render(<PropertyPicker properties={twoPlaces} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();

  expect(screen.queryByLabelText('Поиск объектов')).toBeNull();
});

test('a long list gets a search box, and it narrows by any word', async () => {
  await render(<PropertyPicker properties={manyPlaces} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();
  await fireEvent.changeText(screen.getByLabelText('Поиск объектов'), 'flat 7');

  expect(screen.getByRole('button', { name: 'Flat 7' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Flat 1' })).toBeNull();
});

test('the search ignores case and diacritics, as the panel’s does', async () => {
  const czech = [...manyPlaces, place(20, 'Nádražní 6'), place(21, 'Vinohradská 12')];
  await render(<PropertyPicker properties={czech} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();
  await fireEvent.changeText(screen.getByLabelText('Поиск объектов'), 'NADRAZNI');

  expect(screen.getByRole('button', { name: 'Nádražní 6' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Vinohradská 12' })).toBeNull();
});

test('a search that finds nothing says so', async () => {
  await render(<PropertyPicker properties={manyPlaces} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();
  await fireEvent.changeText(screen.getByLabelText('Поиск объектов'), 'karlin');

  expect(screen.getByText('Ничего не найдено')).toBeTruthy();
});

test('the search starts empty each time the sheet opens', async () => {
  await render(<PropertyPicker properties={manyPlaces} selectedId={null} onSelect={jest.fn()} />);
  await openSheet();
  await fireEvent.changeText(screen.getByLabelText('Поиск объектов'), 'flat 7');
  await fireEvent.press(screen.getByRole('button', { name: 'Flat 7' }));

  await openSheet();

  expect(screen.getByLabelText('Поиск объектов').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Flat 1' })).toBeTruthy();
});

test('a cleaner linked to nothing is told so, not left staring at a blank', async () => {
  await render(<PropertyPicker properties={[]} selectedId={null} onSelect={jest.fn()} />);

  await openSheet();

  expect(screen.getByText('За вами пока не закреплён ни один объект')).toBeTruthy();
});

test('while the list is on its way it says so rather than claiming there is none', async () => {
  await render(<PropertyPicker properties={[]} selectedId={null} onSelect={jest.fn()} isLoading />);

  expect(screen.getByText('Загружаем объекты…')).toBeTruthy();
});
