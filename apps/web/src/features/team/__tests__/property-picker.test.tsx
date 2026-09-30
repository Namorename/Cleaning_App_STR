import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FormEvent } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { PropertyPicker } from '../property-picker';
import type { Property } from '../schema';

const properties: Property[] = [
  { id: 1, name: 'Anděl 4' },
  { id: 2, name: 'Vinohradská 12' },
];

function renderPicker() {
  render(
    <PropertyPicker properties={properties} selected={[]} isPending={false} onChange={vi.fn()} />,
  );
}

describe('PropertyPicker search', () => {
  test('finds a listing typed without its diacritics', async () => {
    renderPicker();

    await userEvent.type(screen.getByRole('searchbox'), 'andel');

    expect(screen.getByRole('checkbox', { name: 'Anděl 4' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Vinohradská 12' })).not.toBeInTheDocument();
  });

  test('takes the words in any order, as every other search of the panel', async () => {
    renderPicker();

    await userEvent.type(screen.getByRole('searchbox'), '12 vinohradska');

    expect(screen.getByRole('checkbox', { name: 'Vinohradská 12' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Anděl 4' })).not.toBeInTheDocument();
  });
});

// A street of three flats and one elsewhere: the manager puts a cleaner on the
// street by typing it and ticking what is left in sight.
const street: Property[] = [
  { id: 1, name: 'Nádražní 10' },
  { id: 2, name: 'Nádražní 12' },
  { id: 3, name: 'Nádražní 14' },
  { id: 4, name: 'Anděl 4' },
];

function Picker({ initial = [] }: { initial?: number[] }) {
  const [selected, setSelected] = useState<number[]>(initial);
  return (
    <PropertyPicker
      properties={street}
      selected={selected}
      isPending={false}
      onChange={setSelected}
    />
  );
}

describe('PropertyPicker select all and clear all', () => {
  test('«Выбрать все» ticks exactly the listings the search left in sight and says how many', async () => {
    render(<Picker />);

    await userEvent.type(screen.getByRole('searchbox'), 'nadrazni');
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (3)' }));

    expect(screen.getByRole('checkbox', { name: 'Nádražní 10' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Nádražní 12' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Nádražní 14' })).toBeChecked();
    expect(screen.getByText('Выбрано: 3')).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox'));

    expect(screen.getByRole('checkbox', { name: 'Anděl 4' })).not.toBeChecked();
  });

  test('adds to what was ticked before, in sight or not, and never ticks a listing twice', async () => {
    const onChange = vi.fn();
    render(
      <PropertyPicker
        properties={street}
        selected={[4, 1]}
        isPending={false}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByRole('searchbox'), 'nadrazni');
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (2)' }));

    expect(onChange).toHaveBeenCalledWith([4, 1, 2, 3]);
  });

  test('«Снять все» unticks only what is in sight and keeps the hidden ones ticked', async () => {
    const onChange = vi.fn();
    render(
      <PropertyPicker
        properties={street}
        selected={[1, 4, 2]}
        isPending={false}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByRole('searchbox'), 'nadrazni');
    await userEvent.click(screen.getByRole('button', { name: 'Снять все (2)' }));

    expect(onChange).toHaveBeenCalledWith([4]);
  });

  test('a button that would change nothing is off, and pressing it does nothing', async () => {
    const onChange = vi.fn();
    render(
      <PropertyPicker properties={street} selected={[]} isPending={false} onChange={onChange} />,
    );

    const clear = screen.getByRole('button', { name: 'Снять все (0)' });
    expect(clear).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(clear);

    expect(onChange).not.toHaveBeenCalled();
  });

  test('after a press the button that has nothing left to do turns off, the other on', async () => {
    render(<Picker />);

    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (4)' }));

    expect(screen.getByRole('button', { name: 'Выбрать все (0)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Снять все (4)' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  // A browser drops the focus of a button that gains `disabled`, and the
  // keyboard lands on the page behind the dialog; jsdom does not, so the test
  // holds the mechanism instead: off is said with aria-disabled, not disabled.
  test('a button pressed from the keyboard stays focusable when it turns off', async () => {
    render(<Picker />);

    screen.getByRole('button', { name: 'Выбрать все (4)' }).focus();
    await userEvent.keyboard('{Enter}');

    const pressed = screen.getByRole('button', { name: 'Выбрать все (0)' });
    expect(pressed).toHaveFocus();
    expect(pressed).not.toHaveAttribute('disabled');
    expect(pressed).toHaveAttribute('aria-disabled', 'true');
  });

  test('the count under the list is announced when a press changes it', async () => {
    render(<Picker />);

    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (4)' }));

    expect(screen.getByRole('status')).toHaveTextContent('Выбрано: 4');
  });

  test('nothing in sight: both buttons stay put and do nothing', async () => {
    render(<Picker initial={[4]} />);

    await userEvent.type(screen.getByRole('searchbox'), 'zizkov');

    expect(screen.getByRole('button', { name: 'Выбрать все (0)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Снять все (0)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
  });

  // The form reads the person's links whole, archived listings included, and
  // the picker lists only the live catalogue: a tick it cannot show is still a
  // link, and dropping it would delete the link on save.
  test('a ticked listing the picker does not list is never touched by either button', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PropertyPicker
        properties={street}
        selected={[99, 1]}
        isPending={false}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByRole('searchbox'), 'nadrazni');
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (2)' }));

    expect(onChange).toHaveBeenLastCalledWith([99, 1, 2, 3]);

    rerender(
      <PropertyPicker
        properties={street}
        selected={[99, 1, 2, 3]}
        isPending={false}
        onChange={onChange}
      />,
    );
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Снять все (3)' }));

    expect(onChange).toHaveBeenLastCalledWith([99]);
  });

  test('the buttons do not send the form the picker sits in', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Picker />
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Выбрать все (4)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Снять все (4)' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The picker sits in the person's form: Enter after typing a street would
  // save the person — and send the new account its letter — before a single
  // listing is ticked.
  test('Enter in the search narrows the list and does not send the form', async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Picker />
        <button type="submit">Создать</button>
      </form>,
    );

    await userEvent.type(screen.getByRole('searchbox'), 'nadrazni{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выбрать все (3)' })).toBeInTheDocument();
  });
});
