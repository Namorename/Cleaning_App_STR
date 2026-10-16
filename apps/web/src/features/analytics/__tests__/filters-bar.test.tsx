import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { FiltersBar, type FilterOption } from '../filters-bar';
import { NO_FILTERS, type AnalyticsFilters } from '../schema';

// The suite reads in Russian (vitest.setup.ts).
const LISTINGS: readonly FilterOption[] = [
  { id: '1', label: 'Old Town flat' },
  { id: '2', label: 'River house' },
];
const ANNA = '11111111-1111-4111-8111-111111111111';
const BOSS = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const PEOPLE: readonly FilterOption[] = [{ id: ANNA, label: 'Anna Novak' }];
const STAFF: readonly FilterOption[] = [...PEOPLE, { id: BOSS, label: 'Olga Boss' }];

// Every listing a chip can name: the offered ones and an archived one the switch hides.
const ALL_LISTINGS: readonly FilterOption[] = [...LISTINGS, { id: '3', label: 'Gone flat (в архиве)' }];

function bar(
  filters: AnalyticsFilters = NO_FILTERS,
  onChange = vi.fn(),
  staff: readonly FilterOption[] | null = STAFF,
) {
  render(
    <div>
      <FiltersBar
        filters={filters}
        listings={LISTINGS}
        listingNames={ALL_LISTINGS}
        people={PEOPLE}
        staff={staff}
        onChange={onChange}
      />
      <p>Elsewhere on the page</p>
    </div>,
  );
  return onChange;
}

const group = (name: string) => screen.getByText(name, { selector: 'summary' }).closest('details') as HTMLElement;

describe('FiltersBar', () => {
  test('a ticked value joins its filter', () => {
    const onChange = bar();
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'River house' }));
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, propertyIds: [2] });
  });

  test('a filter opens on its button and closes on Escape, back on its button', () => {
    bar();
    const summary = screen.getByText('Объекты', { selector: 'summary' });
    fireEvent.click(summary);
    expect(group('Объекты')).toHaveAttribute('open');

    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'River house' }), { key: 'Escape' });
    expect(group('Объекты')).not.toHaveAttribute('open');
    expect(summary).toHaveFocus();
  });

  test('a click outside closes an open filter, a click inside does not', () => {
    bar();
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));

    fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'River house' }));
    expect(group('Объекты')).toHaveAttribute('open');

    fireEvent.pointerDown(screen.getByText('Elsewhere on the page'));
    expect(group('Объекты')).not.toHaveAttribute('open');
  });

  test('one filter open at a time: opening another closes the first', () => {
    bar();
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));
    const people = screen.getByText('Сотрудники', { selector: 'summary' });
    fireEvent.pointerDown(people);
    fireEvent.click(people);
    expect(group('Объекты')).not.toHaveAttribute('open');
    expect(group('Сотрудники')).toHaveAttribute('open');
  });

  test('the archived listings are shown unless the switch hides them', () => {
    const onChange = bar();
    const hide = screen.getByRole('checkbox', { name: 'Скрыть архивные' });
    expect(hide).not.toBeChecked();
    fireEvent.click(hide);
    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, hideArchived: true });
  });

  test('the switch stays on when it is on, and a click turns it off', () => {
    const onChange = bar({ ...NO_FILTERS, hideArchived: true });
    const hide = screen.getByRole('checkbox', { name: 'Скрыть архивные' });
    expect(hide).toBeChecked();
    fireEvent.click(hide);
    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
  });

  test('a chip names whom it filters: a former employee as such, never by an id', () => {
    bar({ ...NO_FILTERS, personIds: [ANNA, BOSS, GONE] });
    expect(screen.getByRole('button', { name: 'Снять фильтр: Anna Novak' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять фильтр: Olga Boss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять фильтр: Бывший сотрудник' })).toBeInTheDocument();
    expect(screen.queryByText(GONE)).not.toBeInTheDocument();
  });

  test('the focus moving on to the next filter closes the open one', () => {
    bar();
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));
    fireEvent.focusOut(screen.getByRole('checkbox', { name: 'River house' }), {
      relatedTarget: screen.getByText('Сотрудники', { selector: 'summary' }),
    });
    expect(group('Объекты')).not.toHaveAttribute('open');
  });

  test('a press inside that leaves the focus nowhere keeps the filter open', () => {
    bar();
    fireEvent.click(screen.getByText('Объекты', { selector: 'summary' }));
    // Safari does not focus a checkbox it ticks: the focus just leaves.
    fireEvent.focusOut(screen.getByText('Объекты', { selector: 'summary' }), { relatedTarget: null });
    expect(group('Объекты')).toHaveAttribute('open');
  });

  test('a chip names a listing the filter no longer offers, never by an id', () => {
    bar({ ...NO_FILTERS, propertyIds: [3], hideArchived: true });
    expect(screen.getByRole('button', { name: 'Снять фильтр: Gone flat (в архиве)' })).toBeInTheDocument();
  });

  test('while the team is still loading, nobody is called a former employee', () => {
    bar({ ...NO_FILTERS, personIds: [ANNA, GONE] }, vi.fn(), null);
    expect(screen.queryByText('Бывший сотрудник')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять фильтр: Anna Novak' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять фильтр: Загрузка…' })).toBeInTheDocument();
  });

  test('a chip lets its value go, and «clear» lets everything go', () => {
    const onChange = bar({ ...NO_FILTERS, propertyIds: [1, 2], hideArchived: true });
    fireEvent.click(screen.getByRole('button', { name: 'Снять фильтр: Old Town flat' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, propertyIds: [2], hideArchived: true });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить все фильтры' }));
    expect(onChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });
});
