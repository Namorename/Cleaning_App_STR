import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { NativeSelect } from './native-select';

/**
 * The 21 bare <select> of the panel moved onto one component (5.2). It must
 * stay the element it replaced: one <select>, no wrapper, the label still
 * pointing at it, the value and the change handler passed straight through.
 */
describe('NativeSelect', () => {
  test('is the browser’s own select, labelled and controlled as before', async () => {
    const onChange = vi.fn();
    render(
      <div data-testid="row">
        <label htmlFor="unit">Единица</label>
        <NativeSelect id="unit" value="pcs" onChange={(event) => onChange(event.target.value)}>
          <option value="pcs">шт.</option>
          <option value="kg">кг</option>
        </NativeSelect>
      </div>,
    );

    const select = screen.getByRole('combobox', { name: 'Единица' });
    expect(select.tagName).toBe('SELECT');
    expect(select.parentElement).toBe(screen.getByTestId('row'));
    expect(select).toHaveValue('pcs');

    await userEvent.selectOptions(select, 'kg');
    expect(onChange).toHaveBeenCalledWith('kg');
  });

  test('draws the field outline and the focus ring of the theme', () => {
    render(<NativeSelect aria-label="Статус" />);

    const select = screen.getByRole('combobox', { name: 'Статус' });
    expect(select).toHaveAttribute('data-slot', 'native-select');
    expect(select).toHaveClass('border-input', 'focus-visible:ring-ring/50');
  });

  test('takes a smaller size and the caller’s classes', () => {
    render(<NativeSelect aria-label="Кто" size="sm" className="px-3" />);

    const select = screen.getByRole('combobox', { name: 'Кто' });
    expect(select).toHaveAttribute('data-size', 'sm');
    expect(select).toHaveClass('px-3');
    expect(select).not.toHaveClass('px-2');
  });
});
