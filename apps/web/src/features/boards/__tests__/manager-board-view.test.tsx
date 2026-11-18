import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  boardCardSchema,
  boardSchema,
  cardDetailSchema,
  myCardSchema,
  type Board,
  type BoardCard,
  type CardDetail,
  type MyCard,
  type OfficePerson,
} from '../schema';

const TODAY = '2026-11-18';
const BOARD = 'b0a2d100-0000-4000-8000-000000000001';
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const READER = 'aaaaaaaa-0000-4000-8000-000000000002';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000003';
const cardId = (n: number) => `b0a2d200-0000-4000-8000-00000000000${n}`;

function makeBoard(overrides: Partial<Board> = {}): Board {
  return boardSchema.parse({
    id: BOARD,
    title: 'Проекты',
    owner_id: OWNER,
    archived_at: null,
    created_at: '2026-11-01T10:00:00Z',
    owner: { full_name: 'Ольга Владелец' },
    ...overrides,
  });
}

function makeCard(n: number, overrides: Partial<BoardCard> = {}): BoardCard {
  return boardCardSchema.parse({
    id: cardId(n),
    board_id: BOARD,
    title: `Карточка ${n}`,
    description: '',
    column_key: 'open',
    color: null,
    due_on: null,
    property_id: null,
    created_at: `2026-11-0${n}T10:00:00Z`,
    moved_at: `2026-11-0${n}T10:00:00Z`,
    archived_at: null,
    deleted_at: null,
    property: null,
    steps: [],
    ...overrides,
  });
}

const CARDS: BoardCard[] = [
  makeCard(1, {
    title: 'Ремонт ванной',
    color: 'blue',
    due_on: '2026-11-10',
    steps: [
      { id: 's1', body: 'Плитка', done_at: '2026-11-11T10:00:00Z' },
      { id: 's2', body: 'Краска', done_at: null },
      { id: 's3', body: 'Сантехник', done_at: null },
    ],
  }),
  makeCard(2, { title: 'Звонок юристу', column_key: 'in_progress', due_on: TODAY }),
  makeCard(3, { title: 'Закупка готова', column_key: 'resolved' }),
  makeCard(4, {
    title: 'Старый проект',
    column_key: 'resolved',
    archived_at: '2026-11-12T10:00:00Z',
  }),
  makeCard(5, { title: 'Ошибочная', deleted_at: '2026-11-13T10:00:00Z' }),
];

const DETAIL: CardDetail = cardDetailSchema.parse({
  ...CARDS[0],
  description: 'План: https://example.com/plan',
  created_by: OWNER,
  creator: { full_name: 'Ольга Владелец' },
  steps: [
    { id: 's1', body: 'Плитка', sort_order: 1, done_at: '2026-11-11T10:00:00Z' },
    { id: 's2', body: 'Краска', sort_order: 2, done_at: '2026-11-12T10:00:00Z' },
    { id: 's3', body: 'Сантехник', sort_order: 3, done_at: '2026-11-13T10:00:00Z' },
  ],
  entries: [
    {
      id: 'e1',
      kind: 'moved',
      body: null,
      facts: { from: 'open', to: 'assigned' },
      author_id: OWNER,
      created_at: '2026-11-11T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Ольга Владелец' },
    },
    {
      id: 'e2',
      kind: 'comment',
      body: 'Сантехник придёт во вторник',
      facts: {},
      author_id: OWNER,
      created_at: '2026-11-12T09:00:00Z',
      edited_at: '2026-11-12T10:00:00Z',
      author: { full_name: 'Ольга Владелец' },
    },
    {
      id: 'e3',
      kind: 'comment',
      body: 'Заметка админа',
      facts: {},
      author_id: ADMIN,
      created_at: '2026-11-13T09:00:00Z',
      edited_at: null,
      author: { full_name: 'Анна Админ' },
    },
  ],
});

const state = {
  boards: [makeBoard()] as Board[],
  cards: CARDS,
  detail: DETAIL as CardDetail | null,
  /** The last read of the cards failed, the rows read before it still in hand. */
  isStale: false,
  /** The writes the server refuses (by their spy). */
  failing: new Set<unknown>(),
  people: [] as OfficePerson[],
  mine: [] as MyCard[],
};

const GONE = 'aaaaaaaa-0000-4000-8000-000000000009';
const PEOPLE: OfficePerson[] = [
  { id: ADMIN, full_name: 'Анна Админ', role: 'admin', is_active: true },
  { id: GONE, full_name: 'Вера Ушла', role: 'manager', is_active: false },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000008',
    full_name: 'Галя Горничная',
    role: 'cleaner',
    is_active: true,
  },
  { id: READER, full_name: 'Ира Читатель', role: 'manager', is_active: true },
  { id: OWNER, full_name: 'Ольга Владелец', role: 'manager', is_active: true },
];

/** Every write the view asks for; `onSuccess` runs at once, as a server that agrees. */
const spies = {
  saveCard: vi.fn(),
  move: vi.fn(),
  shelve: vi.fn(),
  duplicate: vi.fn(),
  archiveBoard: vi.fn(),
  saveBoard: vi.fn(),
  saveStep: vi.fn(),
  tick: vi.fn(),
  deleteStep: vi.fn(),
  orderSteps: vi.fn(),
  saveComment: vi.fn(),
  deleteComment: vi.fn(),
  assign: vi.fn(),
};

function mutation(spy: (variables: unknown) => void) {
  return {
    isPending: false,
    isError: false,
    error: null,
    mutate: (
      variables: unknown,
      options?: {
        onSuccess?: () => void;
        onError?: (error: unknown) => void;
        onSettled?: () => void;
      },
    ) => {
      spy(variables);
      if (state.failing.has(spy)) {
        options?.onError?.({ message: 'refused', hint: 'serverErrors.boardNotYours' });
      } else {
        options?.onSuccess?.();
      }
      options?.onSettled?.();
    },
  };
}

vi.mock('../use-boards', () => ({
  useBoards: () => ({ isPending: false, isError: false, error: null, data: state.boards }),
  useBoardCards: () => ({
    isPending: false,
    isError: state.isStale,
    error: state.isStale ? new Error('offline') : null,
    data: state.cards,
  }),
  useCard: () => ({
    isPending: false,
    isError: state.isStale,
    error: state.isStale ? new Error('offline') : null,
    data: state.detail,
  }),
  useSaveCard: () => mutation(spies.saveCard),
  useMoveCard: () => mutation(spies.move),
  useSetCardShelf: () => mutation(spies.shelve),
  useDuplicateCard: () => mutation(spies.duplicate),
  useSetBoardArchived: () => mutation(spies.archiveBoard),
  useSaveBoard: () => mutation(spies.saveBoard),
  useSaveStep: () => mutation(spies.saveStep),
  useSetStepDone: () => mutation(spies.tick),
  useDeleteStep: () => mutation(spies.deleteStep),
  useOrderSteps: () => mutation(spies.orderSteps),
  useSaveComment: () => mutation(spies.saveComment),
  useDeleteComment: () => mutation(spies.deleteComment),
  useSetCardAssignee: () => mutation(spies.assign),
  useOfficePeople: () => ({ isPending: false, isError: false, error: null, data: state.people }),
  useMyCards: () => ({ isPending: false, isError: false, error: null, data: state.mine }),
}));

vi.mock('@/features/tasks/use-tasks', () => ({ useProperties: () => ({ data: [] }) }));

vi.mock('@/lib/format-date', async (original) => ({
  ...(await original<typeof import('@/lib/format-date')>()),
  todayIso: () => TODAY,
}));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
    useRouter: () => ({ push: vi.fn() }),
  };
});

import { ManagerBoardView } from '../manager-board-view';
import { MyCardsView } from '../my-cards-view';

function show(viewer: { id: string; isAdmin: boolean }, search = `?board=${BOARD}`) {
  window.history.replaceState(null, '', `/problems${search}`);
  return render(<ManagerBoardView boardId={BOARD} viewer={viewer} />);
}

const column = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  state.boards = [makeBoard()];
  state.cards = CARDS;
  state.detail = DETAIL;
  state.isStale = false;
  state.failing = new Set();
  state.people = PEOPLE;
  state.mine = [];
  vi.clearAllMocks();
});

describe('after the review of the panel', () => {
  test('a refresh that fails keeps the board and the open card, and says so', () => {
    state.isStale = true;
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    expect(screen.getByRole('dialog')).toHaveTextContent('Сантехник придёт во вторник');
    expect(screen.getByText('Звонок юристу')).toBeInTheDocument();
    expect(screen.getByText(/^Не удалось обновить доску/)).toBeInTheDocument();
  });

  test('the card moves by a press of its column, never by arrowing through a list', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const group = within(screen.getByRole('dialog')).getByRole('group', { name: 'Переместить в…' });
    expect(within(group).getByRole('button', { name: 'Открыто' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group).getByRole('button', { name: 'В работе' }));
    expect(spies.move).toHaveBeenCalledWith({ cardId: cardId(1), column: 'in_progress' });
    await user.click(within(group).getByRole('button', { name: 'Открыто' }));
    expect(spies.move).toHaveBeenCalledTimes(1);
  });

  test('a copy refused once is asked again under the same id', async () => {
    const user = userEvent.setup();
    state.failing.add(spies.duplicate);
    show({ id: OWNER, isAdmin: false });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(
        screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Дублировать' }));
    }
    const [first, second] = spies.duplicate.mock.calls.map(
      ([variables]) => (variables as { cardId: string }).cardId,
    );
    expect(second).toBe(first);
  });

  test('an older refusal does not hide the «Отменить» of a later success', async () => {
    const user = userEvent.setup();
    state.failing.add(spies.duplicate);
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Дублировать' }));
    expect(screen.getByRole('status')).toHaveTextContent('Менять доску может только её владелец');
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Звонок юристу»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'В архив' }));
    expect(screen.getByRole('status')).toHaveTextContent('Карточка в архиве');
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();
  });

  test('a step is deleted only after a question', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    await user.click(
      within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Удалить шаг' })[0],
    );
    expect(spies.deleteStep).not.toHaveBeenCalled();
    const question = await screen.findByRole('dialog', { name: 'Удалить шаг?' });
    await user.click(within(question).getByRole('button', { name: 'Удалить шаг' }));
    expect(spies.deleteStep).toHaveBeenCalledWith('s1');
  });

  test('the address of a card of another board opens it read only', () => {
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      board_id: 'b0a2d100-0000-4000-8000-000000000009',
    });
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('textbox', { name: 'Комментарий' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Дублировать' })).not.toBeInTheDocument();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the owner', () => {
  test("sees the four columns of the technicians' board, with the cards on the board only", () => {
    show({ id: OWNER, isAdmin: false });
    expect(within(column('Открыто')).getByText('Ремонт ванной')).toBeInTheDocument();
    expect(within(column('В работе')).getByText('Звонок юристу')).toBeInTheDocument();
    expect(within(column('Выполнено')).getByText('Закупка готова')).toBeInTheDocument();
    expect(within(column('Назначено')).getByText('Пусто')).toBeInTheDocument();
    expect(screen.queryByText('Старый проект')).not.toBeInTheDocument();
    expect(screen.queryByText('Ошибочная')).not.toBeInTheDocument();
  });

  test('reads what is late and what is due today above the board', () => {
    show({ id: OWNER, isAdmin: false });
    expect(screen.getByRole('button', { name: 'Просрочено: 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Срок сегодня: 1' })).toBeInTheDocument();
    expect(screen.getByText('Открытых карточек: 2')).toBeInTheDocument();
  });

  test('a card shows its colour by name, its due date and its progress', () => {
    show({ id: OWNER, isAdmin: false });
    const card = screen.getByRole('article', { name: 'Ремонт ванной' });
    expect(within(card).getByText('Синий')).toBeInTheDocument();
    expect(within(card).getByText('Просрочено: 10.11')).toBeInTheDocument();
    expect(within(card).getByText('Шагов отмечено: 1 из 3')).toBeInTheDocument();
  });

  test('adds a card in a column by its title and Enter', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.type(
      screen.getByRole('textbox', { name: 'Новая карточка в колонке «Назначено»' }),
      'Позвонить электрику{Enter}',
    );
    expect(spies.saveCard).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: BOARD,
        column: 'assigned',
        fields: {
          title: 'Позвонить электрику',
          description: '',
          dueOn: null,
          propertyId: null,
          color: null,
        },
      }),
    );
  });

  test('moves a card to another column from its menu', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'В «Выполнено»' }));
    expect(spies.move).toHaveBeenCalledWith({ cardId: cardId(1), column: 'resolved' });
  });

  test('deletes a card softly, and «Отменить» brings it back', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Звонок юристу»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Удалить' }));
    expect(spies.shelve).toHaveBeenLastCalledWith({ cardId: cardId(2), shelf: 'deleted' });
    expect(screen.getByRole('status')).toHaveTextContent('Карточка удалена');
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(spies.shelve).toHaveBeenLastCalledWith({ cardId: cardId(2), shelf: 'active' });
  });

  test('copies a card with its steps under «(копия)»', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Дублировать' }));
    expect(spies.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: cardId(1), title: 'Ремонт ванной (копия)' }),
    );
  });

  test('the search and the summary narrow the board', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по карточкам' }), 'краска');
    expect(screen.getByText('Ремонт ванной')).toBeInTheDocument();
    expect(screen.queryByText('Звонок юристу')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Поиск по карточкам' }));
    await user.click(screen.getByRole('button', { name: 'Срок сегодня: 1' }));
    expect(screen.getByText('Звонок юристу')).toBeInTheDocument();
    expect(screen.queryByText('Ремонт ванной')).not.toBeInTheDocument();
    expect(within(column('Открыто')).getByText('Ничего не найдено')).toBeInTheDocument();
  });

  test('the archive keeps the archived and the deleted apart, each with «Вернуть»', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('tab', { name: /Архив/ }));
    const archived = screen.getByRole('region', { name: /В архиве/ });
    const deleted = screen.getByRole('region', { name: /Удалённые/ });
    expect(within(archived).getByText('Старый проект')).toBeInTheDocument();
    expect(within(deleted).getByText('Ошибочная')).toBeInTheDocument();
    await user.click(within(deleted).getByRole('button', { name: 'Вернуть' }));
    expect(spies.shelve).toHaveBeenCalledWith({ cardId: cardId(5), shelf: 'active' });
  });
});

describe('another manager', () => {
  test('reads the board and is told who may change it; nothing to change it with', () => {
    show({ id: READER, isAdmin: false });
    expect(
      screen.getByText('Доску меняет её владелец или админ, карточку — ещё и её исполнитель.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ремонт ванной')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /Новая карточка в колонке/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Действия с карточкой/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить карточку' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).not.toBeInTheDocument();
  });
});

describe('an admin', () => {
  test("changes anybody's board", () => {
    show({ id: ADMIN, isAdmin: true });
    expect(screen.getAllByRole('textbox', { name: /Новая карточка в колонке/ })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Добавить карточку' })).toBeInTheDocument();
  });
});

describe('an archived board', () => {
  test('is read only until its owner brings it back', async () => {
    const user = userEvent.setup();
    state.boards = [makeBoard({ archived_at: '2026-11-15T10:00:00Z' })];
    show({ id: OWNER, isAdmin: false });
    expect(screen.getByText('Доска в архиве: карточки только для просмотра.')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /Новая карточка в колонке/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Вернуть доску' }));
    expect(spies.archiveBoard).toHaveBeenCalledWith({ boardId: BOARD, archived: false });
  });
});

describe('a card opened over the board', () => {
  test('its links open, its journal is in order with names, times and «изменено»', () => {
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'https://example.com/plan' })).toHaveAttribute(
      'href',
      'https://example.com/plan',
    );
    const lines = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.closest('ol'));
    expect(lines.map((line) => line.textContent)).toEqual([
      expect.stringContaining('Перемещена в колонку «Назначено»'),
      expect.stringMatching(/Ольга Владелец.*изменено.*Сантехник придёт во вторник/),
      expect.stringMatching(/Анна Админ.*Заметка админа/),
    ]);
  });

  test("the owner changes and deletes her own comment, not the admin's", () => {
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    const lines = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.closest('ol'));
    expect(within(lines[1]).getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
    expect(within(lines[1]).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(within(lines[2]).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(within(lines[2]).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
    expect(within(lines[0]).queryByRole('button')).not.toBeInTheDocument();
  });

  test("an admin deletes the owner's comment but does not change it", () => {
    show({ id: ADMIN, isAdmin: true }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    const lines = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.closest('ol'));
    expect(within(lines[1]).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(within(lines[1]).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  test('with every step ticked it offers «Выполнено», and does nothing by itself', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const offer = screen.getByText('Все шаги отмечены. Перенести карточку в «Выполнено»?');
    expect(spies.move).not.toHaveBeenCalled();
    await user.click(
      within(offer.closest('div') as HTMLElement).getByRole('button', { name: 'Перенести' }),
    );
    expect(spies.move).toHaveBeenCalledWith({ cardId: cardId(1), column: 'resolved' });
  });

  test('«Не сейчас» puts the offer away', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    await user.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(screen.queryByText(/Все шаги отмечены/)).not.toBeInTheDocument();
  });

  test('a tick, a new step and a comment go to their functions', async () => {
    const user = userEvent.setup();
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      steps: [{ id: 's2', body: 'Краска', sort_order: 1, done_at: null }],
    });
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Краска' }));
    expect(spies.tick).toHaveBeenCalledWith({ stepId: 's2', done: true });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Добавить шаг' }),
      'Убрать мусор{Enter}',
    );
    expect(spies.saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: cardId(1), body: 'Убрать мусор' }),
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Комментарий' }),
      'Готово к пятнице',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(spies.saveComment).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: cardId(1), body: 'Готово к пятнице' }),
    );
  });

  test('another manager reads the card: no ticks, no journal box, no actions', () => {
    show({ id: READER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    for (const box of within(dialog).getAllByRole('checkbox')) {
      expect(box).toBeDisabled();
    }
    expect(within(dialog).queryByRole('textbox', { name: 'Комментарий' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Дублировать' })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Все шаги отмечены/)).not.toBeInTheDocument();
  });
});

/** A paragraph whose whole text is this: a label and its value in two nodes. */
const paragraph = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text;

describe('the assignee of a card (20261118230000)', () => {
  const withAssignees = () => [
    makeCard(1, {
      title: 'Ремонт ванной',
      assignee_id: READER,
      assignee: { full_name: 'Ира Читатель' },
    }),
    makeCard(2, {
      title: 'Звонок юристу',
      column_key: 'assigned',
      assignee_id: OWNER,
      assignee: { full_name: 'Ольга Владелец' },
    }),
  ];

  test('a card shows its assignee by initials, named for a reader', () => {
    state.cards = withAssignees();
    show({ id: OWNER, isAdmin: false });
    const tile = screen.getByRole('article', { name: 'Ремонт ванной' });
    expect(within(tile).getByText('ИЧ')).toBeInTheDocument();
    expect(within(tile).getByText('Исполнитель: Ира Читатель')).toHaveClass('sr-only');
    expect(
      within(column('Назначено')).getByText('Исполнитель: Ольга Владелец'),
    ).toBeInTheDocument();
  });

  test('the owner gives the card to another manager from a menu, and to nobody', async () => {
    const user = userEvent.setup();
    state.cards = withAssignees();
    state.detail = { ...DETAIL, assignee_id: READER, assignee: { full_name: 'Ира Читатель' } };
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Исполнитель: Ира Читатель' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Анна Админ' }));
    expect(spies.assign).toHaveBeenCalledWith({ cardId: cardId(1), assigneeId: ADMIN });
    await user.click(within(dialog).getByRole('button', { name: 'Исполнитель: Ира Читатель' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Без исполнителя' }));
    expect(spies.assign).toHaveBeenLastCalledWith({ cardId: cardId(1), assigneeId: null });
  });

  test('the assignee moves her card on a board not hers, and nothing else of it', async () => {
    const user = userEvent.setup();
    state.cards = withAssignees();
    show({ id: READER, isAdmin: false });
    expect(
      screen.queryByRole('button', { name: 'Действия с карточкой «Звонок юристу»' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить карточку' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    expect(await screen.findByRole('menuitem', { name: 'В «В работе»' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Дублировать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'В архив' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'В «В работе»' }));
    expect(spies.move).toHaveBeenCalledWith({ cardId: cardId(1), column: 'in_progress' });
  });

  test('the assignee works on the card open — column, steps, journal — but does not assign it', () => {
    state.cards = withAssignees();
    state.detail = { ...DETAIL, assignee_id: READER, assignee: { full_name: 'Ира Читатель' } };
    show({ id: READER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Переместить в…' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
    expect(within(dialog).getByText(paragraph('Исполнитель: Ира Читатель'))).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Исполнитель:/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Дублировать' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'В архив' })).not.toBeInTheDocument();
  });

  test('another manager neither works on the card nor assigns it', () => {
    state.cards = withAssignees();
    state.detail = { ...DETAIL, assignee_id: OWNER, assignee: { full_name: 'Ольга Владелец' } };
    show({ id: READER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('group', { name: 'Переместить в…' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Комментарий' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(paragraph('Исполнитель: Ольга Владелец'))).toBeInTheDocument();
  });

  test('the filter narrows the board to one person; «Назначено мне» comes first', async () => {
    const user = userEvent.setup();
    state.cards = withAssignees();
    show({ id: OWNER, isAdmin: false });
    const filter = screen.getByRole('combobox', { name: 'Исполнитель' });
    expect(
      within(filter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Исполнитель: Все',
      'Назначено мне',
      'Без исполнителя',
      'Анна Админ',
      'Ира Читатель',
    ]);
    await user.selectOptions(filter, OWNER);
    expect(screen.getByText('Звонок юристу')).toBeInTheDocument();
    expect(screen.queryByText('Ремонт ванной')).not.toBeInTheDocument();
    await user.selectOptions(filter, READER);
    expect(screen.getByText('Ремонт ванной')).toBeInTheDocument();
    expect(screen.queryByText('Звонок юристу')).not.toBeInTheDocument();
  });

  test("a new card is the owner's unless another person is picked", async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Исполнитель' })).toHaveValue(OWNER);
    await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), 'Свет в коридоре');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));
    expect(spies.saveCard).toHaveBeenCalledTimes(1);
    expect(spies.assign).not.toHaveBeenCalled();
  });

  test('a new card given to another person is made, then assigned', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Исполнитель' }), READER);
    await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), 'Свет в коридоре');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));
    const created = (spies.saveCard.mock.calls[0][0] as { cardId: string }).cardId;
    expect(spies.assign).toHaveBeenCalledWith({ cardId: created, assigneeId: READER });
  });

  test('the journal says who the card went to, by the names of the company', () => {
    state.detail = {
      ...DETAIL,
      entries: [
        ...DETAIL.entries,
        {
          id: 'e9',
          kind: 'assignee_changed',
          body: null,
          facts: { from: OWNER, to: READER },
          author_id: OWNER,
          created_at: '2026-11-14T09:00:00Z',
          edited_at: null,
          author: { full_name: 'Ольга Владелец' },
        },
      ],
    };
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    expect(
      within(screen.getByRole('dialog')).getByText(
        'Исполнитель изменён: Ольга Владелец → Ира Читатель',
      ),
    ).toBeInTheDocument();
  });

  test("«Назначено мне» shows the viewer's cards of every board, each naming its board", () => {
    const other = 'b0a2d100-0000-4000-8000-000000000002';
    state.boards = [makeBoard(), makeBoard({ id: other, title: 'Закупки', owner_id: READER })];
    state.mine = [
      myCardSchema.parse({
        ...makeCard(1, { title: 'Ремонт ванной', assignee_id: OWNER }),
        board: { id: BOARD, title: 'Проекты', owner_id: OWNER, archived_at: null },
      }),
      myCardSchema.parse({
        ...makeCard(2, { title: 'Купить лампы', board_id: other, assignee_id: OWNER }),
        board: { id: other, title: 'Закупки', owner_id: READER, archived_at: null },
      }),
    ];
    window.history.replaceState(null, '', '/problems?board=mine');
    render(<MyCardsView viewer={{ id: OWNER, isAdmin: false }} />);
    expect(screen.getByRole('heading', { name: 'Назначено мне' })).toBeInTheDocument();
    const bathroom = screen.getByRole('article', { name: 'Ремонт ванной' });
    expect(within(bathroom).getByText('Доска «Проекты»')).toBeInTheDocument();
    const lamps = screen.getByRole('article', { name: 'Купить лампы' });
    expect(within(lamps).getByText('Доска «Закупки»')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /Новая карточка в колонке/ }),
    ).not.toBeInTheDocument();
  });

  test('«Назначено мне» with nothing assigned says so', () => {
    window.history.replaceState(null, '', '/problems?board=mine');
    render(<MyCardsView viewer={{ id: OWNER, isAdmin: false }} />);
    expect(screen.getByText('Вам пока не назначено ни одной карточки')).toBeInTheDocument();
  });
});

describe('a journal line of a kind this panel does not know', () => {
  test('is skipped, and the card opens with the rest of its journal', () => {
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      entries: [...DETAIL.entries, { ...DETAIL.entries[0], id: 'e8', kind: 'reminded', facts: {} }],
    });
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    expect(
      within(screen.getByRole('dialog')).getByText('Сантехник придёт во вторник'),
    ).toBeInTheDocument();
  });
});

describe('after the review of the panel, stage 2', () => {
  test('only active managers and admins are offered, in the menu and in the filter', async () => {
    const user = userEvent.setup();
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Исполнитель: Без исполнителя',
      }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Ира Читатель' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Вера Ушла' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Галя Горничная' })).not.toBeInTheDocument();
  });

  test('the journal names a person switched off since', () => {
    state.detail = {
      ...DETAIL,
      entries: [
        ...DETAIL.entries,
        {
          id: 'e9',
          kind: 'assignee_changed',
          body: null,
          facts: { from: GONE, to: null },
          author_id: OWNER,
          created_at: '2026-11-14T09:00:00Z',
          edited_at: null,
          author: { full_name: 'Ольга Владелец' },
        },
      ],
    };
    show({ id: OWNER, isAdmin: false }, `?board=${BOARD}&card=${cardId(1)}`);
    expect(
      within(screen.getByRole('dialog')).getByText('Исполнитель снят (был Вера Ушла)'),
    ).toBeInTheDocument();
  });

  test('a new card whose assignment is refused keeps the form open', async () => {
    const user = userEvent.setup();
    state.failing.add(spies.assign);
    show({ id: OWNER, isAdmin: false });
    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Исполнитель' }), READER);
    await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), 'Свет в коридоре');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));
    expect(spies.assign).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveTextContent('Новая карточка');
  });

  test('a new card on a board whose owner cannot hold one defaults to nobody, with no second write', async () => {
    const user = userEvent.setup();
    state.people = PEOPLE.map((person) =>
      person.id === OWNER ? { ...person, is_active: false } : person,
    );
    show({ id: ADMIN, isAdmin: true });
    await user.click(screen.getByRole('button', { name: 'Добавить карточку' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Исполнитель' })).toHaveValue('none');
    await user.type(within(dialog).getByRole('textbox', { name: 'Название' }), 'Свет');
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }));
    expect(spies.saveCard).toHaveBeenCalledTimes(1);
    expect(spies.assign).not.toHaveBeenCalled();
  });

  test('«Назначено мне» opens a card by its address even when it is not in the list', () => {
    window.history.replaceState(null, '', `/problems?board=mine&card=${cardId(1)}`);
    render(<MyCardsView viewer={{ id: OWNER, isAdmin: false }} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Сантехник придёт во вторник');
  });
});
