import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { PropertyPicker } from '../property-picker';
import type { Property } from '../schema';

const properties: Property[] = [
  { id: 1, name: 'Anděl 4' },
  { id: 2, name: 'Vinohradská 12' },
];

function renderPicker() {
  render(<PropertyPicker properties={properties} selected={[]} isPending={false} onChange={vi.fn()} />);
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
