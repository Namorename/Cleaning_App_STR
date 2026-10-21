import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MultiSelectFilter, SHORT_LIST_MAX, type MultiSelectOption } from './multi-select-filter';

// The suite reads in Russian (vitest.setup.ts).
const LONG: readonly MultiSelectOption[] = [
  { id: '1', label: 'CZ - Vinohradská Royal — 1 - 2109' },
  { id: '2', label: 'CZ - Vinohradská Royal — 2 - 2110' },
  { id: '3', label: 'Žižkov Loft' },
  { id: '4', label: 'Старый город, Арбат' },
  ...Array.from({ length: 8 }, (_, index) => ({ id: String(index + 5), label: `Flat ${index + 5}` })),
];
const SHORT: readonly MultiSelectOption[] = LONG.slice(0, SHORT_LIST_MAX);

interface HarnessProps {
  options?: readonly MultiSelectOption[];
  initial?: readonly string[];
  wholeMeansAll?: boolean;
  onChange?: (next: string[]) => void;
}

/** The filter as a page holds it: the choice lives outside, and every change comes back in. */
function Harness({ options = LONG, initial = [], wholeMeansAll, onChange }: HarnessProps) {
  const [selected, setSelected] = useState<readonly string[]>(initial);
  return (
    <div>
      <MultiSelectFilter
        label="Объекты"
        options={options}
        selected={selected}
        wholeMeansAll={wholeMeansAll}
        onChange={(next) => {
          onChange?.(next);
          setSelected(next);
        }}
      />
      <p>Elsewhere on the page</p>
    </div>
  );
}

const summary = () => screen.getByText('Объекты', { selector: 'summary' });
const open = () => fireEvent.click(summary());
const searchBox = () => screen.getByRole('searchbox', { name: 'Поиск: Объекты' });
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } });
const rows = () => screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
const selectAll = () => screen.getByRole('button', { name: 'Выбрать всё' });
const clearAll = () => screen.getByRole('button', { name: 'Убрать всё' });
const counter = () => screen.getByRole('status');

function pointer(isFine: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({ matches: isFine && query === '(pointer: fine)', media: query })),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('MultiSelectFilter', () => {
  test('a short list stays as it was: no search, no buttons, a tick per value', () => {
    const onChange = vi.fn();
    render(<Harness options={SHORT} onChange={onChange} />);
    open();

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выбрать всё' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(SHORT_LIST_MAX);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Žižkov Loft' }));
    expect(onChange).toHaveBeenLastCalledWith(['3']);
  });

  test('the search ignores case and diacritics, and takes the words in any order', () => {
    render(<Harness />);
    open();

    type('vinohradska');
    expect(rows()).toEqual(['CZ - Vinohradská Royal — 1 - 2109', 'CZ - Vinohradská Royal — 2 - 2110']);

    type('2109 VINOHRADSKA');
    expect(rows()).toEqual(['CZ - Vinohradská Royal — 1 - 2109']);

    type('zizkov');
    expect(rows()).toEqual(['Žižkov Loft']);

    type('арбат СТАРЫЙ');
    expect(rows()).toEqual(['Старый город, Арбат']);
  });

  test('a search that finds nothing says so', () => {
    render(<Harness />);
    open();
    type('nowhere street');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });

  test('«Выбрать всё» ticks the rows found, and a tick the search hides stays', () => {
    const onChange = vi.fn();
    render(<Harness initial={['3']} onChange={onChange} />);
    open();
    type('vinohradska');

    fireEvent.click(selectAll());
    expect(onChange).toHaveBeenLastCalledWith(['3', '1', '2']);
    expect(counter()).toHaveTextContent('Выбрано 3 из 12');
  });

  test('«Убрать всё» unticks the rows found, and a tick the search hides stays', () => {
    const onChange = vi.fn();
    render(<Harness initial={['1', '3', '2']} onChange={onChange} />);
    open();
    type('vinohradska');

    fireEvent.click(clearAll());
    expect(onChange).toHaveBeenLastCalledWith(['3']);

    type('');
    expect(screen.getByRole('checkbox', { name: 'Žižkov Loft' })).toBeChecked();
    expect(counter()).toHaveTextContent('Выбрано 1 из 12');
  });

  test('with nothing typed the buttons act on the whole list, and an id it does not offer stays', () => {
    const onChange = vi.fn();
    render(<Harness initial={['gone', '4']} onChange={onChange} />);
    open();

    fireEvent.click(selectAll());
    expect(onChange).toHaveBeenLastCalledWith(['gone', '4', ...LONG.filter((one) => one.id !== '4').map((one) => one.id)]);
    expect(counter()).toHaveTextContent('Выбрано 12 из 12');
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(clearAll());
    expect(onChange).toHaveBeenLastCalledWith(['gone']);
    expect(counter()).toHaveTextContent('Выбрано 0 из 12');
  });

  test('a button with nothing left to change is off', () => {
    render(<Harness initial={['1', '2']} />);
    open();
    expect(clearAll()).toBeEnabled();
    type('vinohradska');
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true');
    type('zizkov');
    expect(clearAll()).toHaveAttribute('aria-disabled', 'true');
  });

  test('where nothing ticked means all, the counter says so and a whole list shows no count', () => {
    render(<Harness wholeMeansAll />);
    expect(summary()).toHaveTextContent(/^Объекты$/);
    open();
    expect(counter()).toHaveTextContent('Выбрано 0 из 12 — учитываются все');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Žižkov Loft' }));
    expect(summary()).toHaveTextContent('Объекты1');

    fireEvent.click(selectAll());
    expect(counter()).toHaveTextContent('Выбрано 12 из 12');
    expect(summary()).toHaveTextContent(/^Объекты$/);
  });

  test('elsewhere a whole list keeps its count on the button', () => {
    render(<Harness initial={LONG.map((one) => one.id)} />);
    expect(summary()).toHaveTextContent('Объекты12');
  });

  test('Escape closes the list, gives the focus back to its button and forgets the search', () => {
    render(<Harness />);
    open();
    type('zizkov');
    fireEvent.keyDown(searchBox(), { key: 'Escape' });

    expect(summary().closest('details')).not.toHaveAttribute('open');
    expect(summary()).toHaveFocus();

    open();
    expect(searchBox()).toHaveValue('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(LONG.length);
  });

  test('a press outside closes the list', () => {
    render(<Harness />);
    open();
    fireEvent.pointerDown(screen.getByText('Elsewhere on the page'));
    expect(summary().closest('details')).not.toHaveAttribute('open');
  });

  test('with a mouse the search takes the focus at once', () => {
    pointer(true);
    render(<Harness />);
    open();
    expect(searchBox()).toHaveFocus();
  });

  test('on a touch screen the search waits for a tap, so no keyboard covers the list', () => {
    pointer(false);
    render(<Harness />);
    open();
    expect(searchBox()).not.toHaveFocus();
  });

  test('Enter in the search is kept from a form the filter may sit in', () => {
    render(<Harness />);
    open();
    type('zizkov');
    // fireEvent answers false when the handler prevented the default.
    expect(fireEvent.keyDown(searchBox(), { key: 'Enter' })).toBe(false);
  });
});
