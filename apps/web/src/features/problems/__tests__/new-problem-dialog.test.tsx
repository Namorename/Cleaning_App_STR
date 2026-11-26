import { DUE_DAYS_AHEAD } from '@str-ops/shared';
import { CATALOG_FIXTURE } from '@str-ops/shared/src/testing/problem-categories.fixture';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { addDays } from '@/features/calendar/dates';
import { todayIso } from '@/lib/format-date';

import type { ReportCatalog } from '../catalog';
import { EMPTY_PROBLEM_FILTERS } from '../filters';

// «Новое задание» of a company that reports by catalogue (CLIENT:Wagnerstays, owner 2026-11-20):
// the category is the task's name and urgency, picked as the cleaners pick it on the phone.

const report = vi.fn();
const catalogState: { current: ReportCatalog } = { current: { kind: 'free' } };
vi.mock('../use-problems', () => ({
  useReportProblem: () => ({ mutate: report, isPending: false, isError: false, error: null }),
  useReportCatalog: () => catalogState.current,
}));

const listings = [
  { id: 1, name: 'Vinohrady 12', parent_id: null, hostaway_unit_id: null, status: 'active', timezone: 'Europe/Prague' },
  { id: 2, name: 'Karlín 3', parent_id: null, hostaway_unit_id: null, status: 'active', timezone: 'Europe/Prague' },
];
vi.mock('@/features/tasks/use-tasks', () => ({ useProperties: () => ({ data: listings }) }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { NewProblemDialog } from '../new-problem-dialog';

const CATALOG: ReportCatalog = { kind: 'catalog', categories: CATALOG_FIXTURE as never };
const FLOOD = CATALOG_FIXTURE.find((category) => category.name === 'Затопление');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const onClose = vi.fn();

function openForm() {
  render(
    <NewProblemDialog from={{ view: 'board', filters: EMPTY_PROBLEM_FILTERS }} onClose={onClose} />,
  );
  return screen.getByRole('dialog', { name: 'Новое задание' });
}

const field = (form: HTMLElement) => within(form).getByRole('combobox', { name: 'Категория' });
const optionNames = (form: HTMLElement) =>
  within(within(form).getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.getAttribute('aria-label'));

beforeEach(() => {
  report.mockReset();
  push.mockReset();
  onClose.mockReset();
  catalogState.current = CATALOG;
});

describe('a company that reports by catalogue', () => {
  test('the form asks for a category instead of a title, and offers no urgency to choose', () => {
    const form = openForm();

    expect(field(form)).toBeInTheDocument();
    expect(within(form).queryByLabelText('Что случилось')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('Срочность')).not.toBeInTheDocument();
    expect(within(form).queryByText(/задаётся категорией/i)).not.toBeInTheDocument();
    // What happened in the manager's words stays free.
    expect(within(form).getByLabelText('Подробности')).toBeInTheDocument();
  });

  test('the list is the phone’s: low on top, critical at the bottom, each with its urgency', async () => {
    const form = openForm();
    await userEvent.click(field(form));

    const names = optionNames(form);
    expect(names).toHaveLength(27);
    expect(names[0]).toBe('Косметические дефекты, срочность: Низкая');
    expect(names[8]).toBe('Освещение, срочность: Обычная');
    expect(names[14]).toBe('Wi-Fi, срочность: Высокая');
    expect(names[26]).toBe('Затопление, срочность: Критическая');
    // The level is a chip with its word, not colour alone.
    expect(within(within(within(form).getByRole('listbox')).getAllByRole('option')[26]).getByText('Критическая')).toBeVisible();
  });

  test('typing narrows the list by the first letters of a word, ё as е, synonyms too', async () => {
    const form = openForm();
    const input = field(form);

    await userEvent.type(input, 'БЕЛЬЕ');
    expect(optionNames(form)).toEqual([
      'Доставка (бельё, химия, кроватка и т. д.), срочность: Низкая',
    ]);

    await userEvent.clear(input);
    await userEvent.type(input, 'кран');
    expect(optionNames(form)).toEqual(['Смесители, срочность: Обычная']);

    await userEvent.clear(input);
    await userEvent.type(input, 'гор вод');
    expect(optionNames(form)).toEqual(['Горячая вода, срочность: Критическая']);

    await userEvent.clear(input);
    await userEvent.type(input, 'элек');
    // In the list's order: the partial outage (high) above the whole one (critical).
    expect(optionNames(form)).toEqual([
      'Частичное отсутствие электричества, срочность: Высокая',
      'Электричество полностью, срочность: Критическая',
    ]);

    await userEvent.clear(input);
    await userEvent.type(input, 'ектр');
    expect(within(form).queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(form).getByRole('status')).toHaveTextContent('Ничего не найдено');
  });

  test('a category is required: «Создать» waits for one', async () => {
    const form = openForm();
    const create = within(form).getByRole('button', { name: 'Создать' });

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(form).getByLabelText('Подробности'), 'Вода на полу');
    expect(create).toBeDisabled();
    expect(field(form)).toBeRequired();

    await userEvent.click(field(form));
    await userEvent.click(within(form).getByRole('option', { name: /^Царапины/ }));
    expect(create).toBeEnabled();
  });

  test('a critical category files the task under its name, high with the flag, with its id', async () => {
    report.mockImplementation((variables, options) =>
      options?.onSuccess?.({ id: variables.problemId }),
    );
    const form = openForm();

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Karlín 3');
    await userEvent.type(field(form), 'затоп');
    // Enter takes the row in focus and never sends the form.
    await userEvent.keyboard('{Enter}');
    expect(report).not.toHaveBeenCalled();

    expect(field(form)).toHaveValue('Затопление');
    expect(field(form)).toHaveAccessibleDescription('Критическая');
    await userEvent.type(within(form).getByLabelText('Подробности'), '  Вода из-под ванны ');
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report).toHaveBeenCalledTimes(1);
    const [variables] = report.mock.calls[0];
    expect(variables).toEqual({
      problemId: expect.stringMatching(UUID),
      title: 'Затопление',
      description: 'Вода из-под ванны',
      priority: 'high',
      critical: true,
      categoryId: FLOOD?.id,
      propertyId: 2,
    });
    expect(push).toHaveBeenCalledWith(`/problems/${variables.problemId}`);
  });

  test('a low category goes out low, without the flag', async () => {
    const form = openForm();
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Без объекта');
    await userEvent.click(field(form));
    await userEvent.click(within(form).getByRole('option', { name: /^Баки/ }));
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report.mock.calls[0][0]).toMatchObject({
      title: 'Баки',
      priority: 'low',
      critical: false,
      propertyId: null,
    });
  });

  test('the keyboard: arrows walk the list, Escape closes it and leaves the form', async () => {
    const form = openForm();
    // A click opens the list on its first row.
    await userEvent.click(field(form));
    expect(field(form)).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(field(form)).toHaveAttribute(
      'aria-activedescendant',
      within(form).getByRole('option', { name: /^Царапины/ }).id,
    );
    await userEvent.keyboard('{Enter}');
    expect(field(form)).toHaveValue('Царапины');

    await userEvent.keyboard('{ArrowDown}');
    expect(field(form)).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(field(form)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Новое задание' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The choice stays when the list closes without a new one.
    expect(field(form)).toHaveValue('Царапины');
  });

  test('letters typed right after a pick are a new search, not added to the name', async () => {
    const form = openForm();
    await userEvent.type(field(form), 'царап');
    await userEvent.keyboard('{Enter}');
    expect(field(form)).toHaveValue('Царапины');

    // The focus and the caret stay after the name (no click): what comes next is a search of its own.
    expect(field(form)).toHaveFocus();
    await userEvent.keyboard('душ');
    expect(optionNames(form)).toEqual(['Душ, срочность: Высокая']);
  });

  test('the form stands from the top, so the list opening below does not move it', () => {
    const form = openForm();
    expect(form).toHaveClass('top-4', 'translate-y-0', 'overflow-y-auto');
    // The centring of the base dialog is gone, not merely outnumbered.
    expect(form).not.toHaveClass('top-1/2');
    expect(form).not.toHaveClass('-translate-y-1/2');
  });

  test('another pick replaces the first, and the search starts empty again', async () => {
    const form = openForm();
    await userEvent.click(field(form));
    await userEvent.click(within(form).getByRole('option', { name: /^Декор/ }));
    await userEvent.click(field(form));

    expect(field(form)).toHaveValue('');
    expect(optionNames(form)).toHaveLength(27);
    expect(within(form).getByRole('option', { name: /^Декор/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(within(form).getByRole('option', { name: /^Душ/ }));
    expect(field(form)).toHaveValue('Душ');
  });
});

describe('a company that types, and a catalogue that did not load', () => {
  // `free` is what a free_text company gets, and what a catalogue company gets while its list
  // cannot be read or is empty (catalog.ts reportCatalogOf): the form of before.
  test('the form of before: a title and the urgency, no category', async () => {
    catalogState.current = { kind: 'free' };
    const form = openForm();

    expect(within(form).queryByRole('combobox', { name: 'Категория' })).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Срочность')).toHaveDisplayValue('Обычная');
    // In the middle of the window, where it always stood.
    expect(form).not.toHaveClass('top-4');
    expect(form).not.toHaveClass('overflow-y-auto');

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
    await userEvent.selectOptions(within(form).getByLabelText('Срочность'), 'Критическая');
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    const [variables] = report.mock.calls[0];
    expect(variables).toEqual({
      problemId: expect.stringMatching(UUID),
      title: 'Течёт кран',
      description: '',
      priority: 'high',
      critical: true,
      propertyId: 1,
    });
    expect(variables).not.toHaveProperty('categoryId');
  });

  test('while the catalogue is on its way: neither field, and «Создать» waits', async () => {
    catalogState.current = { kind: 'pending' };
    const form = openForm();

    expect(within(form).getByRole('status', { name: 'Загрузка…' })).toBeInTheDocument();
    expect(within(form).queryByRole('combobox', { name: 'Категория' })).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('Что случилось')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');
    expect(within(form).getByRole('button', { name: 'Создать' })).toBeDisabled();
  });

  test('the form keeps the way it opened with: a catalogue that arrives later swaps nothing', async () => {
    catalogState.current = { kind: 'free' };
    const form = openForm();
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт');

    catalogState.current = CATALOG;
    await userEvent.type(within(form).getByLabelText('Что случилось'), ' кран');

    expect(within(form).getByLabelText('Что случилось')).toHaveValue('Течёт кран');
    expect(within(form).queryByRole('combobox', { name: 'Категория' })).not.toBeInTheDocument();
  });

  test('a catalogue that arrives while the form waits is the one it takes', async () => {
    catalogState.current = { kind: 'pending' };
    const form = openForm();
    catalogState.current = CATALOG;
    // Any change of the form draws it again with the answer.
    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');

    expect(field(form)).toBeInTheDocument();
    expect(within(form).queryByLabelText('Что случилось')).not.toBeInTheDocument();
  });
});

describe('the day the task is to be done (owner, 2026-11-26)', () => {
  const today = todayIso();
  const planned = addDays(today, 10);
  const dueField = (form: HTMLElement) => within(form).getByLabelText('Дата выполнения');

  test('an optional date, today up to a year ahead, with what it does said under it', () => {
    catalogState.current = { kind: 'free' };
    const form = openForm();

    expect(dueField(form)).toHaveAttribute('type', 'date');
    expect(dueField(form)).toHaveValue('');
    expect(dueField(form)).not.toBeRequired();
    expect(dueField(form)).toHaveAttribute('min', today);
    expect(dueField(form)).toHaveAttribute('max', addDays(today, DUE_DAYS_AHEAD - 1));
    expect(dueField(form)).toHaveAccessibleDescription(/очередь техников/);
  });

  test('a typed task sends the day it plans', async () => {
    catalogState.current = { kind: 'free' };
    const form = openForm();

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
    fireEvent.change(dueField(form), { target: { value: planned } });
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report.mock.calls[0][0]).toMatchObject({ title: 'Течёт кран', dueOn: planned });
  });

  test('a task picked from the catalogue sends it too', async () => {
    const form = openForm();

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Karlín 3');
    await userEvent.click(field(form));
    await userEvent.click(within(form).getByRole('option', { name: /^Царапины/ }));
    fireEvent.change(dueField(form), { target: { value: planned } });
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report.mock.calls[0][0]).toMatchObject({ propertyId: 2, dueOn: planned });
  });

  test('no day planned sends none: the call of before', async () => {
    catalogState.current = { kind: 'free' };
    const form = openForm();

    await userEvent.selectOptions(within(form).getByLabelText('Объект'), 'Vinohrady 12');
    await userEvent.type(within(form).getByLabelText('Что случилось'), 'Течёт кран');
    fireEvent.change(dueField(form), { target: { value: planned } });
    fireEvent.change(dueField(form), { target: { value: '' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Создать' }));

    expect(report.mock.calls[0][0]).not.toHaveProperty('dueOn');
  });
});
