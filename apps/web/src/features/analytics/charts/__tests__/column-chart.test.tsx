import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ColumnChart, type ColumnPoint, type ColumnSeries } from '../column-chart';

const SERIES: readonly ColumnSeries[] = [
  { name: 'Done', fillClass: 'fill-[var(--chart-1)]', swatchClass: 'bg-[var(--chart-1)]' },
  { name: 'Checkouts', fillClass: 'fill-[var(--chart-2)]', swatchClass: 'bg-[var(--chart-2)]' },
];

const POINTS: readonly ColumnPoint[] = [
  { key: '2026-10-01', label: '1.10', values: [2, 1], description: 'October 1: 2 done, 1 checkout' },
  { key: '2026-10-02', label: '2.10', values: [3, 2], description: 'October 2: 3 done, 2 checkouts' },
  { key: '2026-10-03', label: '3.10', values: [0, 0], description: 'October 3: nothing' },
];

function draw(onSelect = vi.fn()) {
  render(<ColumnChart title="Cleanings by day" series={SERIES} points={POINTS} onSelect={onSelect} />);
  const columns = POINTS.map((point) => screen.getByRole('button', { name: point.description }));
  return { onSelect, columns };
}

describe('ColumnChart', () => {
  test('names the chart and every column, and lists its series', () => {
    draw();
    expect(screen.getByRole('group', { name: 'Cleanings by day' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Checkouts')).toBeInTheDocument();
  });

  test('a click, Enter or Space picks a column', () => {
    const { onSelect, columns } = draw();
    fireEvent.click(columns[1]);
    fireEvent.keyDown(columns[0], { key: 'Enter' });
    fireEvent.keyDown(columns[2], { key: ' ' });
    expect(onSelect.mock.calls).toEqual([['2026-10-02'], ['2026-10-01'], ['2026-10-03']]);
  });

  test('the chart is one stop of the Tab key: the first column, the rest out of the order', () => {
    const { columns } = draw();
    expect(columns.map((column) => column.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  test('the arrow keys walk the columns and take the Tab stop with them', () => {
    const { onSelect, columns } = draw();
    columns[0].focus();

    fireEvent.keyDown(columns[0], { key: 'ArrowRight' });
    expect(columns[1]).toHaveFocus();
    expect(columns.map((column) => column.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);

    fireEvent.keyDown(columns[1], { key: 'ArrowLeft' });
    expect(columns[0]).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('Home and End go to the ends, and an arrow past an end stays put', () => {
    const { columns } = draw();
    columns[0].focus();

    fireEvent.keyDown(columns[0], { key: 'End' });
    expect(columns[2]).toHaveFocus();
    fireEvent.keyDown(columns[2], { key: 'ArrowRight' });
    expect(columns[2]).toHaveFocus();

    fireEvent.keyDown(columns[2], { key: 'Home' });
    expect(columns[0]).toHaveFocus();
    fireEvent.keyDown(columns[0], { key: 'ArrowLeft' });
    expect(columns[0]).toHaveFocus();
  });

  test('a click moves the Tab stop to the clicked column', () => {
    const { columns } = draw();
    fireEvent.click(columns[2]);
    expect(columns.map((column) => column.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  test('fewer columns after new data keep a column in the Tab order', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ColumnChart title="Cleanings by day" series={SERIES} points={POINTS} onSelect={onSelect} />,
    );
    const last = screen.getByRole('button', { name: POINTS[2].description });
    last.focus();
    fireEvent.keyDown(last, { key: 'End' });

    rerender(
      <ColumnChart title="Cleanings by day" series={SERIES} points={POINTS.slice(0, 1)} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: POINTS[0].description })).toHaveAttribute('tabindex', '0');
  });
});
