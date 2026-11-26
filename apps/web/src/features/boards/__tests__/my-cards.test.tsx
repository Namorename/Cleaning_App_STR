import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cardDetailSchema, myCardSchema } from '../schema';
import {
  BOARD,
  DETAIL,
  OTHER_BOARD,
  OWNER,
  READER,
  cardId,
  makeBoard,
  makeCard,
  makeColumn,
  resetBoards,
  spies,
  state,
} from './fixtures';

/**
 * «Назначено мне» with boards of their own columns and private boards (20261126120000): the lanes
 * are the four stages, a move names a stage, and a card given on a board the viewer does not see is
 * his to work on, not to shelve, copy or give away.
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

import { MyCardsView } from '../my-cards-view';

const WAITING = 'c0a2d300-0000-4000-8000-00000000000b';
const DONE = 'c0a2d300-0000-4000-8000-00000000000c';
const TODO = 'c0a2d300-0000-4000-8000-00000000000a';

/** The private board's columns: the viewer reads them through the card given to him. */
function privateColumns() {
  return [
    makeColumn({ id: TODO, preset: 'open', position: 1, legacy_key: 'open' }),
    makeColumn({ id: WAITING, title: 'Ждём ответа', position: 2, legacy_key: 'in_progress' }),
    makeColumn({ id: DONE, title: 'Сделано', position: 3, is_done: true, legacy_key: 'resolved' }),
  ];
}

/** A card given to READER on BOARD, which he does not see (its board comes as null). */
const privateCard = () =>
  myCardSchema.parse({
    ...makeCard(1, {
      title: 'Ремонт ванной',
      column_id: WAITING,
      column_key: 'in_progress',
      assignee_id: READER,
    }),
    board: null,
  });

/** A card given to READER on a shared board he sees. */
const sharedCard = () =>
  myCardSchema.parse({
    ...makeCard(2, {
      title: 'Купить лампы',
      board_id: OTHER_BOARD,
      column_id: 'c0a2d300-0000-4000-8000-0000000000f1',
      column_key: 'resolved',
      assignee_id: READER,
    }),
    board: { id: OTHER_BOARD, title: 'Закупки', owner_id: OWNER, archived_at: null },
  });

function show(search = '?board=mine') {
  window.history.replaceState(null, '', `/problems${search}`);
  return render(<MyCardsView viewer={{ id: READER, isAdmin: false }} />);
}

const lane = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  resetBoards();
  state.boards = [makeBoard({ id: OTHER_BOARD, title: 'Закупки' })];
  state.columns = privateColumns();
  state.mine = [privateCard(), sharedCard()];
  state.detail = cardDetailSchema.parse({
    ...DETAIL,
    column_id: WAITING,
    column_key: 'in_progress',
    assignee_id: READER,
    assignee: { full_name: 'Ира Читатель' },
  });
});

describe('«Назначено мне»', () => {
  test('stands the cards in the four stages, whatever their boards’ columns are called', () => {
    show();
    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual(['Открыто', 'Назначено', 'В работе', 'Выполнено']);
    expect(within(lane('В работе')).getByText('Ремонт ванной')).toBeInTheDocument();
    expect(within(lane('Выполнено')).getByText('Купить лампы')).toBeInTheDocument();
  });

  test('names a card’s board, or says it is a private one', () => {
    show();
    const hidden = screen.getByRole('article', { name: 'Ремонт ванной' });
    expect(within(hidden).getByText('Закрытая доска')).toBeInTheDocument();
    const shared = screen.getByRole('article', { name: 'Купить лампы' });
    expect(within(shared).getByText('Доска «Закупки»')).toBeInTheDocument();
  });

  test('moves a card by a stage: the server finds the column', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Действия с карточкой «Ремонт ванной»' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'В «Открыто»',
      'В «Назначено»',
      'В «Выполнено»',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'В «Выполнено»' }));
    expect(spies.move).toHaveBeenCalledWith({ cardId: cardId(1), stage: 'resolved' });
  });
});

describe('a card given on a board the viewer does not see', () => {
  const open = () => show(`?board=mine&card=${cardId(1)}`);

  test('opens: its work is his — the column by the board’s columns, the fields, steps, comments', async () => {
    const user = userEvent.setup();
    open();
    const dialog = within(screen.getByRole('dialog'));
    const group = dialog.getByRole('group', { name: 'Переместить в…' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Открыто', 'Ждём ответа', 'Сделано']);
    expect(within(group).getByRole('button', { name: 'Ждём ответа' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(dialog.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Добавить шаг' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Комментарий' })).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Сделано' }));
    expect(spies.move).toHaveBeenCalledWith({
      cardId: cardId(1),
      columnId: DONE,
      stage: 'resolved',
    });
  });

  test('not its shelf, its copy or its assignee', () => {
    open();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('button', { name: 'Дублировать' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'В архив' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /^Исполнитель:/ })).not.toBeInTheDocument();
    expect(dialog.getByText('Ира Читатель')).toBeInTheDocument();
  });

  test('archived meanwhile, it is read without «Вернуть»', () => {
    state.detail = cardDetailSchema.parse({
      ...DETAIL,
      column_id: WAITING,
      archived_at: '2026-11-17T10:00:00Z',
    });
    open();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/Карточка в архиве или удалена/)).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Вернуть' })).not.toBeInTheDocument();
  });

  test('a card on a board he sees keeps its whole dialog', () => {
    state.boards = [makeBoard({ id: BOARD })];
    state.mine = [
      myCardSchema.parse({
        ...privateCard(),
        board: { id: BOARD, title: 'Проекты', owner_id: OWNER, archived_at: null },
      }),
    ];
    open();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Дублировать' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: /^Исполнитель:/ })).toBeInTheDocument();
  });
});
