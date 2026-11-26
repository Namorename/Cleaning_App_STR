import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cardDetailSchema, type ColumnRow } from '../schema';
import {
  BOARD,
  DETAIL,
  OWNER,
  READER,
  cardId,
  makeBoard,
  makeCard,
  makeColumn,
  releaseHeld,
  resetBoards,
  spies,
  state,
} from './fixtures';

/**
 * A board's own columns (20261126120000): the lanes are its live columns, named — a preset one in
 * the reader's language — and cards move, are added and are offered «done» by a column's id; its
 * owner orders, renames, marks and deletes them in «Колонки».
 */

vi.mock('../use-boards', async () => (await import('./fixtures')).useBoardsModule);
vi.mock('@/features/tasks/use-tasks', () => ({ useProperties: () => ({ data: [] }) }));
vi.mock('@/lib/format-date', async (original) => ({
  ...(await original<typeof import('@/lib/format-date')>()),
  todayIso: () => '2026-11-18',
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { router } = await import('./fixtures');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
    useRouter: () => router,
  };
});

import { ColumnsDialog } from '../columns-dialog';
import { ManagerBoardView } from '../manager-board-view';

const TODO = 'c0a2d300-0000-4000-8000-00000000000a';
const WAITING = 'c0a2d300-0000-4000-8000-00000000000b';
const DONE = 'c0a2d300-0000-4000-8000-00000000000c';
const IDEAS = 'c0a2d300-0000-4000-8000-00000000000d';
const OLD = 'c0a2d300-0000-4000-8000-00000000000e';

/** A preset column nobody renamed, two of the owner's own, a finishing one, and a deleted one. */
function ownColumns() {
  return [
    makeColumn({ id: TODO, preset: 'open', position: 1, legacy_key: 'open' }),
    makeColumn({ id: WAITING, title: 'Ждём ответа', position: 2, legacy_key: 'assigned' }),
    makeColumn({
      id: DONE,
      title: 'Сделано',
      position: 3,
      is_done: true,
      legacy_key: 'resolved',
    }),
    makeColumn({ id: IDEAS, title: 'Идеи', position: 4, legacy_key: 'in_progress' }),
    makeColumn({
      id: OLD,
      title: 'Старая',
      position: 2,
      legacy_key: 'assigned',
      deleted_at: '2026-11-15T10:00:00Z',
    }),
  ];
}

function ownCards() {
  return [
    makeCard(1, { title: 'Ремонт ванной', column_id: TODO, column_key: 'open' }),
    makeCard(2, { title: 'Звонок юристу', column_id: WAITING, column_key: 'assigned' }),
    makeCard(3, { title: 'Закупка готова', column_id: DONE, column_key: 'resolved' }),
    makeCard(4, {
      title: 'Старый звонок',
      column_id: WAITING,
      column_key: 'assigned',
      archived_at: '2026-11-12T10:00:00Z',
    }),
  ];
}

function show(viewer = { id: OWNER, isAdmin: false }, search = `?board=${BOARD}`) {
  window.history.replaceState(null, '', `/problems${search}`);
  return render(<ManagerBoardView boardId={BOARD} viewer={viewer} />);
}

const lane = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  resetBoards();
  state.columns = ownColumns();
  state.cards = ownCards();
  state.detail = cardDetailSchema.parse({ ...DETAIL, column_id: TODO, column_key: 'open' });
});

describe('the lanes of a board', () => {
  test('are its live columns in order, a preset one in the reader’s words, a deleted one gone', () => {
    show();
    const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(names).toEqual(['Открыто', 'Ждём ответа', 'Сделано', 'Идеи']);
    expect(within(lane('Открыто')).getByText('Ремонт ванной')).toBeInTheDocument();
    expect(within(lane('Ждём ответа')).getByText('Звонок юристу')).toBeInTheDocument();
    expect(within(lane('Сделано')).getByText('Закупка готова')).toBeInTheDocument();
    expect(within(lane('Идеи')).getByText('Пусто')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Старая' })).not.toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[data-slot="manager-board"]');
    expect(grid?.style.gridTemplateColumns).toBe('repeat(4, minmax(16rem, 1fr))');
  });

  test('a card whose column was deleted meanwhile stands in the first lane of its stage', () => {
    state.cards = [makeCard(1, { title: 'Потерянная', column_id: OLD, column_key: 'assigned' })];
    show();
    expect(within(lane('Ждём ответа')).getByText('Потерянная')).toBeInTheDocument();
  });

  test('a card moves by its menu to another column, by id', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent).slice(0, 3)).toEqual([
      'В «Ждём ответа»',
      'В «Сделано»',
      'В «Идеи»',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'В «Сделано»' }));
    expect(spies.move).toHaveBeenCalledWith({
      cardId: cardId(1),
      columnId: DONE,
      stage: 'resolved',
    });
  });

  test('a card dragged onto another column moves there, by id', () => {
    show();
    fireEvent.dragStart(screen.getByRole('article', { name: 'Ремонт ванной' }));
    fireEvent.dragOver(lane('Идеи'));
    fireEvent.drop(lane('Идеи'));
    expect(spies.move).toHaveBeenCalledWith({
      cardId: cardId(1),
      columnId: IDEAS,
      stage: 'in_progress',
    });
  });

  test('each column ends in a quick add that puts the card in it', async () => {
    const user = userEvent.setup();
    show();
    await user.type(
      screen.getByRole('textbox', { name: 'Новая карточка в колонке «Ждём ответа»' }),
      'Позвонить электрику{Enter}',
    );
    expect(spies.saveCard).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: BOARD, columnId: WAITING }),
    );
  });

  test('«Новая карточка» offers the live columns, the first by default, and sends the id', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByRole('combobox', { name: 'Колонка' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Открыто', 'Ждём ответа', 'Сделано', 'Идеи']);
    expect(select).toHaveValue(TODO);
    await user.selectOptions(select, IDEAS);
    await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), 'Свет');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));
    expect(spies.saveCard).toHaveBeenCalledWith(expect.objectContaining({ columnId: IDEAS }));
  });

  test('a private board says so above it; a shared one does not', () => {
    state.boards = [makeBoard({ shared: false })];
    const view = show();
    expect(screen.getByText('Закрытая доска')).toBeInTheDocument();
    view.unmount();
    state.boards = [makeBoard({ shared: true })];
    show();
    expect(screen.queryByText('Закрытая доска')).not.toBeInTheDocument();
  });
});

describe('a card open over a board of its own columns', () => {
  const open = () => show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);

  test('its column buttons are the live columns, its own pressed; a press moves it by id', async () => {
    const user = userEvent.setup();
    open();
    const group = within(screen.getByRole('dialog')).getByRole('group', { name: 'Переместить в…' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Открыто',
      'Ждём ответа',
      'Сделано',
      'Идеи',
    ]);
    expect(within(group).getByRole('button', { name: 'Открыто' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group).getByRole('button', { name: 'Ждём ответа' }));
    expect(spies.move).toHaveBeenCalledWith({
      cardId: cardId(1),
      columnId: WAITING,
      stage: 'assigned',
    });
  });

  test('with every step ticked it offers the first finishing column by its name', async () => {
    const user = userEvent.setup();
    open();
    const offer = screen.getByText('Все шаги отмечены. Перенести карточку в «Сделано»?');
    await user.click(
      within(offer.closest('div') as HTMLElement).getByRole('button', { name: 'Перенести' }),
    );
    expect(spies.move).toHaveBeenCalledWith({
      cardId: cardId(1),
      columnId: DONE,
      stage: 'resolved',
    });
  });

  test('a board with no finishing column offers nothing', () => {
    state.columns = ownColumns().map((column) => ({ ...column, is_done: false }));
    open();
    expect(screen.queryByText(/Все шаги отмечены/)).not.toBeInTheDocument();
  });

  test('read only, it names the column the card stands in', () => {
    state.boards = [makeBoard({ archived_at: '2026-11-15T10:00:00Z' })];
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      column_id: WAITING,
      column_key: 'assigned',
    });
    open();
    expect(within(screen.getByRole('dialog')).getByText('Ждём ответа')).toBeInTheDocument();
  });

  test('the journal names a column by its name now, a deleted one too, else by its stage', () => {
    const moved = (id: string, facts: Record<string, unknown>) => ({
      ...DETAIL.entries[0],
      id,
      facts,
    });
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      column_id: TODO,
      entries: [
        moved('m1', { from: 'open', to: 'assigned', from_column: TODO, to_column: WAITING }),
        moved('m2', { from: 'assigned', to: 'assigned', from_column: WAITING, to_column: OLD }),
        moved('m3', {
          from: 'open',
          to: 'resolved',
          to_column: 'c0a2d300-0000-4000-8000-0000000000ff',
        }),
        moved('m4', { from: 'open', to: 'in_progress' }),
      ],
    });
    open();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Перемещена в колонку «Ждём ответа»')).toBeInTheDocument();
    expect(dialog.getByText('Перемещена в колонку «Старая»')).toBeInTheDocument();
    expect(dialog.getByText('Перемещена в колонку «Выполнено»')).toBeInTheDocument();
    expect(dialog.getByText('Перемещена в колонку «В работе»')).toBeInTheDocument();
  });
});

describe('«Колонки»', () => {
  async function openColumns(viewer = { id: OWNER, isAdmin: false }) {
    const user = userEvent.setup();
    show(viewer);
    await user.click(screen.getByRole('button', { name: 'Действия с доской' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Колонки' }));
    const dialog = screen.getByRole('dialog', { name: 'Колонки доски «Проекты»' });
    const row = (name: string) => within(dialog).getByRole('listitem', { name });
    return { user, dialog, row };
  }

  test('lists the live columns in order, the deleted one not', async () => {
    const { dialog } = await openColumns();
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Открыто', 'Ждём ответа', 'Сделано', 'Идеи']);
    expect(
      within(dialog).getByText(/Порядок колонок меняется перетаскиванием/),
    ).toBeInTheDocument();
  });

  test('adds a column at the end under an id of its own, a new one for the next', async () => {
    const { user, dialog } = await openColumns();
    const name = within(dialog).getByRole('textbox', { name: 'Название колонки' });
    await user.type(name, 'Счета');
    await user.click(within(dialog).getByRole('button', { name: 'Добавить колонку' }));
    await user.type(name, 'Договоры{Enter}');
    const [first, second] = spies.saveColumn.mock.calls.map(
      ([variables]) => variables as { columnId: string; boardId: string; title: string },
    );
    expect(first).toMatchObject({ boardId: BOARD, title: 'Счета' });
    expect(second).toMatchObject({ boardId: BOARD, title: 'Договоры' });
    expect(second.columnId).not.toBe(first.columnId);
  });

  test('renames a column in place; Escape and the same name send nothing', async () => {
    const { user, row } = await openColumns();
    await user.click(
      within(row('Ждём ответа')).getByRole('button', {
        name: 'Переименовать колонку: Ждём ответа',
      }),
    );
    const field = within(row('Ждём ответа')).getByRole('textbox', { name: 'Название колонки' });
    expect(field).toHaveAttribute('maxLength', '40');
    await user.keyboard('{Escape}');
    expect(spies.saveColumn).not.toHaveBeenCalled();
    await user.click(
      within(row('Открыто')).getByRole('button', { name: 'Переименовать колонку: Открыто' }),
    );
    await user.keyboard('{Enter}');
    expect(spies.saveColumn).not.toHaveBeenCalled();
    await user.click(
      within(row('Ждём ответа')).getByRole('button', {
        name: 'Переименовать колонку: Ждём ответа',
      }),
    );
    const again = within(row('Ждём ответа')).getByRole('textbox', { name: 'Название колонки' });
    await user.clear(again);
    await user.type(again, 'Ждём звонка{Enter}');
    expect(spies.saveColumn).toHaveBeenCalledWith({
      columnId: WAITING,
      boardId: null,
      title: 'Ждём звонка',
    });
  });

  test('«Выше» and «Ниже» send the whole new order; the ends cannot go further', async () => {
    const { user, row } = await openColumns();
    const moves = (name: string) =>
      within(row(name)).getByRole('group', { name: `Переместить колонку «${name}»` });
    expect(within(moves('Открыто')).getByRole('button', { name: 'Выше: Открыто' })).toBeDisabled();
    expect(within(moves('Идеи')).getByRole('button', { name: 'Ниже: Идеи' })).toBeDisabled();
    await user.click(
      within(moves('Ждём ответа')).getByRole('button', { name: 'Выше: Ждём ответа' }),
    );
    expect(spies.orderColumns).toHaveBeenLastCalledWith({
      boardId: BOARD,
      columnIds: [WAITING, TODO, DONE, IDEAS],
    });
    await user.click(within(moves('Сделано')).getByRole('button', { name: 'Ниже: Сделано' }));
    expect(spies.orderColumns).toHaveBeenLastCalledWith({
      boardId: BOARD,
      columnIds: [TODO, WAITING, IDEAS, DONE],
    });
  });

  test('a column dragged onto another takes its place', async () => {
    const { row } = await openColumns();
    fireEvent.dragStart(row('Идеи'));
    fireEvent.dragOver(row('Ждём ответа'));
    fireEvent.drop(row('Ждём ответа'));
    expect(spies.orderColumns).toHaveBeenCalledWith({
      boardId: BOARD,
      columnIds: [TODO, IDEAS, WAITING, DONE],
    });
  });

  test('«Завершающая» is marked and unmarked, with what it means', async () => {
    const { user, row } = await openColumns();
    const done = within(row('Сделано')).getByRole('checkbox', { name: 'Завершающая: Сделано' });
    expect(done).toBeChecked();
    expect(done).toHaveAccessibleDescription(/Карточки в завершающей колонке выполнены/);
    await user.click(within(row('Идеи')).getByRole('checkbox', { name: 'Завершающая: Идеи' }));
    expect(spies.setColumnDone).toHaveBeenCalledWith({ columnId: IDEAS, done: true });
    await user.click(done);
    expect(spies.setColumnDone).toHaveBeenLastCalledWith({ columnId: DONE, done: false });
  });

  test('an empty column is deleted after a question, naming no other', async () => {
    const { user, row } = await openColumns();
    await user.click(within(row('Идеи')).getByRole('button', { name: 'Удалить колонку: Идеи' }));
    expect(spies.deleteColumn).not.toHaveBeenCalled();
    const question = screen.getByRole('dialog', { name: 'Удалить колонку «Идеи»?' });
    expect(question).toHaveTextContent('В колонке нет карточек.');
    expect(within(question).queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Удалить колонку' }));
    expect(spies.deleteColumn).toHaveBeenCalledWith({ columnId: IDEAS, moveToId: null });
  });

  test('a column holding cards — archived ones counted — asks where they go first', async () => {
    const { user, row } = await openColumns();
    await user.click(
      within(row('Ждём ответа')).getByRole('button', { name: 'Удалить колонку: Ждём ответа' }),
    );
    const question = screen.getByRole('dialog', { name: 'Удалить колонку «Ждём ответа»?' });
    expect(question).toHaveTextContent('Карточек в колонке (вместе с архивными и удалёнными): 2.');
    const confirm = within(question).getByRole('button', { name: 'Удалить колонку' });
    expect(confirm).toBeDisabled();
    const target = within(question).getByRole('combobox', { name: 'Куда перенести карточки' });
    expect(
      within(target)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Выберите колонку', 'Открыто', 'Сделано', 'Идеи']);
    await user.selectOptions(target, DONE);
    await user.click(confirm);
    expect(spies.deleteColumn).toHaveBeenCalledWith({ columnId: WAITING, moveToId: DONE });
  });

  test('cards the panel had not read yet: the server’s refusal asks the question', async () => {
    state.refusals.set(spies.deleteColumn, {
      message: 'holds cards',
      hint: 'serverErrors.boardColumnHasCards',
      details: '{"count":3}',
    });
    const { user, row } = await openColumns();
    await user.click(within(row('Идеи')).getByRole('button', { name: 'Удалить колонку: Идеи' }));
    const question = screen.getByRole('dialog', { name: 'Удалить колонку «Идеи»?' });
    await user.click(within(question).getByRole('button', { name: 'Удалить колонку' }));
    expect(within(question).getByRole('alert')).toHaveTextContent(
      'В колонке есть карточки (3): выберите, куда их перенести',
    );
    const target = within(question).getByRole('combobox', { name: 'Куда перенести карточки' });
    expect(question).toHaveTextContent('Карточек в колонке (вместе с архивными и удалёнными): 3.');
    // A retry refused for another reason still asks where the cards go.
    state.refusals.set(spies.deleteColumn, { message: 'no', hint: 'serverErrors.boardNotYours' });
    await user.selectOptions(target, TODO);
    await user.click(within(question).getByRole('button', { name: 'Удалить колонку' }));
    expect(spies.deleteColumn).toHaveBeenLastCalledWith({ columnId: IDEAS, moveToId: TODO });
    expect(
      within(question).getByRole('combobox', { name: 'Куда перенести карточки' }),
    ).toBeInTheDocument();
  });

  test('the last column is never deleted', async () => {
    state.columns = [makeColumn({ id: TODO, preset: 'open', legacy_key: 'open' })];
    state.cards = [];
    const { dialog, row } = await openColumns();
    expect(
      within(row('Открыто')).getByRole('button', { name: 'Удалить колонку: Открыто' }),
    ).toBeDisabled();
    expect(within(dialog).getByText('Последнюю колонку удалить нельзя.')).toBeInTheDocument();
  });

  test('twelve columns are the most: the add rests and says so', async () => {
    state.columns = Array.from({ length: 12 }, (_, index) =>
      makeColumn({
        id: `c0a2d300-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        title: `Колонка ${index + 1}`,
        position: index + 1,
      }),
    );
    state.cards = [];
    const { dialog } = await openColumns();
    expect(within(dialog).getByRole('button', { name: 'Добавить колонку' })).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Название колонки' })).toBeDisabled();
    expect(within(dialog).getByText('Колонок не больше 12.')).toBeInTheDocument();
  });

  test('another manager has no board menu, so no «Колонки»', () => {
    show({ id: READER, isAdmin: false });
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).not.toBeInTheDocument();
  });
});

describe('«Колонки» by the keyboard and a screen reader', () => {
  /**
   * The dialog over columns that take each order the moment it is asked, as the cache does before
   * the server answers.
   */
  function Columns() {
    const [columns, setColumns] = useState<ColumnRow[]>(ownColumns);
    spies.orderColumns.mockImplementation(({ columnIds }: { columnIds: string[] }) =>
      setColumns((now) =>
        now.map((column) => {
          const at = columnIds.indexOf(column.id);
          return at < 0 ? column : { ...column, position: at + 1 };
        }),
      ),
    );
    return (
      <ColumnsDialog
        board={{ id: BOARD, title: 'Проекты' }}
        columns={columns}
        cards={[]}
        onClose={() => undefined}
      />
    );
  }

  function showColumns() {
    const user = userEvent.setup();
    render(<Columns />);
    const dialog = screen.getByRole('dialog', { name: 'Колонки доски «Проекты»' });
    const button = (column: string, label: string) =>
      within(within(dialog).getByRole('listitem', { name: column })).getByRole('button', {
        name: `${label}: ${column}`,
      });
    const order = () =>
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label'));
    return { user, dialog, button, order };
  }

  test('stays on the button pressed — the other one at an end — and says the new place', async () => {
    const { user, dialog, button, order } = showColumns();
    await user.click(button('Идеи', 'Выше'));
    expect(order()).toEqual(['Открыто', 'Ждём ответа', 'Идеи', 'Сделано']);
    expect(button('Идеи', 'Выше')).toHaveFocus();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Идеи: 3 / 4');
    await user.keyboard('{Enter}');
    expect(order()).toEqual(['Открыто', 'Идеи', 'Ждём ответа', 'Сделано']);
    expect(button('Идеи', 'Выше')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(order()).toEqual(['Идеи', 'Открыто', 'Ждём ответа', 'Сделано']);
    expect(button('Идеи', 'Выше')).toBeDisabled();
    expect(button('Идеи', 'Ниже')).toHaveFocus();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Идеи: 1 / 4');
    // Moved down, the row itself is the one put elsewhere in the page: the keyboard follows it.
    await user.keyboard('{Enter}');
    expect(order()).toEqual(['Открыто', 'Идеи', 'Ждём ответа', 'Сделано']);
    expect(button('Идеи', 'Ниже')).toHaveFocus();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Идеи: 2 / 4');
  });

  test('a press while an order is on its way waits its turn, counted from the order before it', async () => {
    state.held = new Set([spies.orderColumns]);
    const { user, button, order } = showColumns();
    await user.click(button('Ждём ответа', 'Выше'));
    await user.click(button('Сделано', 'Выше'));
    expect(spies.orderColumns).toHaveBeenCalledTimes(1);
    act(() => releaseHeld());
    expect(spies.orderColumns).toHaveBeenCalledTimes(2);
    expect(spies.orderColumns).toHaveBeenLastCalledWith({
      boardId: BOARD,
      columnIds: [WAITING, DONE, TODO, IDEAS],
    });
    expect(order()).toEqual(['Ждём ответа', 'Сделано', 'Открыто', 'Идеи']);
  });

  test('a refused order drops the presses that counted on it, and says why', async () => {
    state.held = new Set([spies.orderColumns]);
    state.refusals.set(spies.orderColumns, { message: 'no', hint: 'serverErrors.boardNotYours' });
    const { user, dialog, button } = showColumns();
    await user.click(button('Ждём ответа', 'Выше'));
    await user.click(button('Сделано', 'Выше'));
    act(() => releaseHeld());
    expect(spies.orderColumns).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Менять доску может только её владелец',
    );
  });

  test('Enter and Escape in the name give the keyboard back to «Переименовать»', async () => {
    const { user, button } = showColumns();
    await user.click(button('Ждём ответа', 'Переименовать колонку'));
    await user.keyboard(' звонка{Enter}');
    expect(spies.saveColumn).toHaveBeenCalledWith({
      columnId: WAITING,
      boardId: null,
      title: 'Ждём ответа звонка',
    });
    expect(button('Ждём ответа', 'Переименовать колонку')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(spies.saveColumn).toHaveBeenCalledTimes(1);
    expect(button('Ждём ответа', 'Переименовать колонку')).toHaveFocus();
  });

  test('each control of a row names its column', () => {
    const { dialog } = showColumns();
    const row = within(within(dialog).getByRole('listitem', { name: 'Сделано' }));
    expect(row.getByRole('checkbox', { name: 'Завершающая: Сделано' })).toBeChecked();
    expect(row.getByRole('button', { name: 'Удалить колонку: Сделано' })).toBeEnabled();
    expect(row.getByRole('group', { name: 'Переместить колонку «Сделано»' })).toBeInTheDocument();
  });
});
