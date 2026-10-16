import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { BarList, type BarItem } from '../bar-list';

const ITEMS: readonly BarItem[] = [
  { id: 'a', label: 'Old Town flat', value: 12, valueText: '12' },
  { id: 'b', label: 'River house', value: 3, valueText: '3' },
];

describe('BarList', () => {
  test('every bar is a toggle with its name and figure written out', () => {
    render(<BarList title="Cleanings by listing" items={ITEMS} selected={[]} onToggle={vi.fn()} emptyText="Empty" />);
    expect(screen.getByRole('region', { name: 'Cleanings by listing' })).toBeInTheDocument();
    const bar = screen.getByRole('button', { name: /^Old Town flat\s*12$/ });
    expect(bar).toHaveAttribute('aria-pressed', 'false');
  });

  test('a click hands the bar to the page, picked or not', () => {
    const onToggle = vi.fn();
    render(<BarList title="Cleanings by listing" items={ITEMS} selected={['b']} onToggle={onToggle} emptyText="Empty" />);
    fireEvent.click(screen.getByRole('button', { name: /^River house\s*3$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Old Town flat\s*12$/ }));
    expect(onToggle.mock.calls).toEqual([['b'], ['a']]);
  });

  test('a picked bar stays pressed, the others stay to be added', () => {
    render(<BarList title="Cleanings by listing" items={ITEMS} selected={['b']} onToggle={vi.fn()} emptyText="Empty" />);
    expect(screen.getByRole('button', { name: /^River house/ })).toHaveAttribute('aria-pressed', 'true');
    const other = screen.getByRole('button', { name: /^Old Town flat/ });
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other).toBeEnabled();
  });

  test('says so when there is nothing to draw', () => {
    render(<BarList title="Cleanings by listing" items={[]} selected={[]} onToggle={vi.fn()} emptyText="Nothing to draw" />);
    expect(screen.getByText('Nothing to draw')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('says it is loading in place of the bars', () => {
    render(
      <BarList
        title="Cleanings by listing"
        items={ITEMS}
        selected={[]}
        onToggle={vi.fn()}
        emptyText="Empty"
        status={{ loading: 'Loading…' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('shows why the bars did not come', () => {
    render(
      <BarList
        title="Cleanings by listing"
        items={ITEMS}
        selected={[]}
        onToggle={vi.fn()}
        emptyText="Empty"
        status={{ error: <p>The table could not be loaded</p> }}
      />,
    );
    expect(screen.getByText('The table could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
