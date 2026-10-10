import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { EMPTY_PROBLEM_FILTERS, NO_PLACE, type ProblemFilters } from '../filters';
import { ProblemsFilters } from '../problems-filters';

const PETR = '55555555-5555-4555-8555-555555555555';
const ROYAL = 'CZ - Royal';
const ROOM = `${ROYAL} — 1 - 2109`;

const places = [
  { name: 'Karlín 3', isRoom: false },
  { name: ROYAL, isRoom: false },
  { name: ROOM, isRoom: true },
];
const people = [
  { id: PETR, name: 'Petr Fixer' },
  { id: '66666666-6666-4666-8666-666666666666', name: null },
];

function renderBar(filters: ProblemFilters = EMPTY_PROBLEM_FILTERS) {
  const onChange = vi.fn();
  render(<ProblemsFilters filters={filters} onChange={onChange} places={places} people={people} />);
  return onChange;
}

const optionsOf = (label: string) =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent);

// Built the way «Уборки» build theirs (tasks-filters.tsx): each control named
// above it, 44 px high, the two dates saying which end is which.
describe('the filter bar of «Задания»', () => {
  test('names each control, and each is a 44 px target', () => {
    renderBar();

    for (const label of ['Объект', 'Исполнитель', 'Заявлено с', 'Заявлено по']) {
      expect(screen.getByLabelText(label)).toHaveClass('h-11');
    }
  });

  test('offers every place with a task and «Без объекта», every person and «Не назначено»', () => {
    renderBar();

    expect(optionsOf('Объект')).toEqual(['Любой объект', 'Без объекта', 'Karlín 3', ROYAL, ROOM]);
    expect(optionsOf('Исполнитель')).toEqual([
      'Любой исполнитель',
      'Не назначено',
      'Petr Fixer',
      'Неизвестно',
    ]);
  });

  test('a choice changes that filter and leaves the others', async () => {
    const start = { ...EMPTY_PROBLEM_FILTERS, query: 'кран' };
    const onChange = renderBar(start);

    await userEvent.selectOptions(screen.getByLabelText('Объект'), ROYAL);
    expect(onChange).toHaveBeenLastCalledWith({ ...start, place: { kind: 'place', name: ROYAL } });

    await userEvent.selectOptions(screen.getByLabelText('Объект'), 'Без объекта');
    expect(onChange).toHaveBeenLastCalledWith({ ...start, place: NO_PLACE });

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Не назначено');
    expect(onChange).toHaveBeenLastCalledWith({ ...start, assigneeId: 'nobody' });

    await userEvent.selectOptions(screen.getByLabelText('Исполнитель'), 'Petr Fixer');
    expect(onChange).toHaveBeenLastCalledWith({ ...start, assigneeId: PETR });
  });

  test('shows the chosen values', () => {
    renderBar({
      ...EMPTY_PROBLEM_FILTERS,
      place: { kind: 'place', name: ROOM },
      assigneeId: 'nobody',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-09',
    });

    expect(screen.getByLabelText('Объект')).toHaveDisplayValue(ROOM);
    expect(screen.getByLabelText('Исполнитель')).toHaveDisplayValue('Не назначено');
    expect(screen.getByLabelText('Заявлено с')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Заявлено по')).toHaveValue('2026-10-09');
  });

  test('neither end of the dates can pass the other', () => {
    renderBar({ ...EMPTY_PROBLEM_FILTERS, dateFrom: '2026-10-01', dateTo: '2026-10-09' });

    expect(screen.getByLabelText('Заявлено с')).toHaveAttribute('max', '2026-10-09');
    expect(screen.getByLabelText('Заявлено по')).toHaveAttribute('min', '2026-10-01');
  });

  // `min` and `max` hold only the picker: a date typed past the other end
  // made the range empty (the review of 2981da8..db36705).
  test('a day typed past the other end turns the range round instead of emptying it', () => {
    const start = { ...EMPTY_PROBLEM_FILTERS, dateFrom: '2026-10-01', dateTo: '2026-10-05' };
    const onChange = renderBar(start);

    fireEvent.change(screen.getByLabelText('Заявлено с'), { target: { value: '2026-10-09' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...start,
      dateFrom: '2026-10-05',
      dateTo: '2026-10-09',
    });

    fireEvent.change(screen.getByLabelText('Заявлено по'), { target: { value: '2026-09-20' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...start,
      dateFrom: '2026-09-20',
      dateTo: '2026-10-01',
    });
  });

  test('«Сбросить фильтры» stands there only while something is set, and clears it all', async () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).not.toBeInTheDocument();

    const onChange = renderBar({ ...EMPTY_PROBLEM_FILTERS, query: 'кран', assigneeId: PETR });
    const reset = screen.getByRole('button', { name: 'Сбросить фильтры' });
    expect(reset).toHaveClass('h-11');

    await userEvent.click(reset);
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_PROBLEM_FILTERS);
  });
});
