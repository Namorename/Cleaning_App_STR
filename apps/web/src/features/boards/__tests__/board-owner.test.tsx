import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  ADMIN,
  BOARD,
  OWNER,
  PEOPLE,
  READER,
  makeBoard,
  resetBoards,
  router,
  spies,
  state,
} from './fixtures';

/**
 * The board itself (20261126120000): its menu, who sees it, and handing it over — its owner's and
 * an admin's.
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

import { ManagerBoardView } from '../manager-board-view';

type Viewer = { id: string; isAdmin: boolean };
const AS_OWNER: Viewer = { id: OWNER, isAdmin: false };
const AS_ADMIN: Viewer = { id: ADMIN, isAdmin: true };

function show(viewer: Viewer) {
  window.history.replaceState(null, '', `/problems?board=${BOARD}`);
  return render(<ManagerBoardView boardId={BOARD} viewer={viewer} />);
}

async function pick(viewer: Viewer, item: string) {
  const user = userEvent.setup();
  show(viewer);
  await user.click(screen.getByRole('button', { name: 'Действия с доской' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  return user;
}

beforeEach(() => {
  resetBoards();
});

describe('the board menu', () => {
  test.each([
    ['its owner', AS_OWNER],
    ['an admin', AS_ADMIN],
  ])('%s has the settings, the columns, the handover and the archive', async (_who, viewer) => {
    const user = userEvent.setup();
    show(viewer);
    await user.click(screen.getByRole('button', { name: 'Действия с доской' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Настройки доски',
      'Колонки',
      'Передать доску',
      'Убрать доску в архив',
    ]);
  });

  test('another manager has none', () => {
    show({ id: READER, isAdmin: false });
    expect(screen.queryByRole('button', { name: 'Действия с доской' })).not.toBeInTheDocument();
  });
});

describe('«Настройки доски»', () => {
  test('the owner reads who sees the board and makes it hers alone', async () => {
    const user = await pick(AS_OWNER, 'Настройки доски');
    const dialog = screen.getByRole('dialog', { name: 'Настройки доски' });
    const group = within(dialog).getByRole('group', { name: 'Кто видит доску' });
    expect(within(group).getByRole('radio', { name: 'Видна другим менеджерам' })).toBeChecked();
    expect(within(dialog).getByText(/Админ видит все доски/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Переименовать доску и убрать её в архив может только её владелец или админ.',
      ),
    ).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Видна только мне' }));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(spies.saveBoard).toHaveBeenCalledWith({
      boardId: BOARD,
      title: 'Проекты',
      shared: false,
    });
  });

  test('a rename alone says nothing of who sees the board', async () => {
    const user = await pick(AS_OWNER, 'Настройки доски');
    const dialog = screen.getByRole('dialog', { name: 'Настройки доски' });
    const name = within(dialog).getByRole('textbox', { name: 'Название доски' });
    await user.clear(name);
    await user.type(name, 'Проекты 2027');
    await user.click(within(dialog).getByRole('radio', { name: 'Видна только мне' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Видна другим менеджерам' }));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(spies.saveBoard).toHaveBeenCalledWith({ boardId: BOARD, title: 'Проекты 2027' });
  });

  test('an admin at another’s board reads «Видна только владельцу»', async () => {
    state.boards = [makeBoard({ shared: false })];
    await pick(AS_ADMIN, 'Настройки доски');
    const dialog = screen.getByRole('dialog', { name: 'Настройки доски' });
    expect(within(dialog).getByRole('radio', { name: 'Видна только владельцу' })).toBeChecked();
    expect(
      within(dialog).queryByRole('radio', { name: 'Видна только мне' }),
    ).not.toBeInTheDocument();
  });
});

describe('«Передать доску»', () => {
  const dialogOf = () => screen.getByRole('dialog', { name: 'Передать доску «Проекты»' });

  test('offers the active managers and admins but the owner', async () => {
    await pick(AS_OWNER, 'Передать доску');
    const select = within(dialogOf()).getByRole('combobox', { name: 'Новый владелец' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Выберите менеджера', 'Анна Админ', 'Ира Читатель']);
    expect(within(dialogOf()).getByRole('button', { name: 'Передать' })).toBeDisabled();
  });

  test.each([
    [
      'the owner of a shared board',
      AS_OWNER,
      true,
      'Доска видна другим менеджерам: вы будете видеть её',
    ],
    [
      'the owner of a private board',
      AS_OWNER,
      false,
      'Доска видна только владельцу: после передачи вы её больше не увидите',
    ],
    ['an admin', AS_ADMIN, false, 'Вы админ: доска останется вам видна.'],
  ])('warns %s what it means', async (_who, viewer, shared, warning) => {
    state.boards = [makeBoard({ shared })];
    await pick(viewer, 'Передать доску');
    expect(dialogOf()).toHaveTextContent(warning);
    expect(dialogOf()).toHaveTextContent(
      'Карточки, исполнители и доступ к доске не меняются; новые карточки по умолчанию достаются новому владельцу.',
    );
  });

  test('hands a shared board over and says so, staying on it', async () => {
    const user = await pick(AS_OWNER, 'Передать доску');
    await user.selectOptions(
      within(dialogOf()).getByRole('combobox', { name: 'Новый владелец' }),
      READER,
    );
    await user.click(within(dialogOf()).getByRole('button', { name: 'Передать' }));
    expect(spies.transfer).toHaveBeenCalledWith({ boardId: BOARD, toId: READER });
    expect(screen.getByRole('status')).toHaveTextContent('Доска передана: Ира Читатель');
    expect(router.push).not.toHaveBeenCalled();
  });

  test('an owner who hands his private board over goes to the technicians’ board', async () => {
    state.boards = [makeBoard({ shared: false })];
    const user = await pick(AS_OWNER, 'Передать доску');
    await user.selectOptions(
      within(dialogOf()).getByRole('combobox', { name: 'Новый владелец' }),
      ADMIN,
    );
    await user.click(within(dialogOf()).getByRole('button', { name: 'Передать' }));
    expect(spies.transfer).toHaveBeenCalledWith({ boardId: BOARD, toId: ADMIN });
    expect(router.push).toHaveBeenCalledWith('/problems');
    // The board leaves the cache first: the screen it leaves never says «Доска не найдена».
    expect(spies.forget).toHaveBeenCalledWith(BOARD);
    expect(spies.forget.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
  });

  test('an admin who hands a private board over keeps it on screen', async () => {
    state.boards = [makeBoard({ shared: false })];
    const user = await pick(AS_ADMIN, 'Передать доску');
    await user.selectOptions(
      within(dialogOf()).getByRole('combobox', { name: 'Новый владелец' }),
      READER,
    );
    await user.click(within(dialogOf()).getByRole('button', { name: 'Передать' }));
    expect(router.push).not.toHaveBeenCalled();
    expect(spies.forget).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Доска передана: Ира Читатель');
  });

  test('the people not read: it says so, and nobody can be chosen', async () => {
    state.peopleError = true;
    await pick(AS_OWNER, 'Передать доску');
    const alert = within(dialogOf()).getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить команду.');
    expect(alert).toHaveTextContent('people offline');
    expect(within(dialogOf()).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialogOf()).getByRole('button', { name: 'Передать' })).toBeDisabled();
  });

  test('with nobody to hand it to, it says so', async () => {
    state.people = PEOPLE.filter((person) => person.id === OWNER);
    await pick(AS_OWNER, 'Передать доску');
    expect(dialogOf()).toHaveTextContent('Передать некому');
    expect(within(dialogOf()).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialogOf()).getByRole('button', { name: 'Передать' })).toBeDisabled();
  });

  test('a refusal is said in words, the dialog stays', async () => {
    state.refusals.set(spies.transfer, {
      message: 'cannot',
      hint: 'serverErrors.boardTransferInvalid',
    });
    const user = await pick(AS_OWNER, 'Передать доску');
    await user.selectOptions(
      within(dialogOf()).getByRole('combobox', { name: 'Новый владелец' }),
      READER,
    );
    await user.click(within(dialogOf()).getByRole('button', { name: 'Передать' }));
    expect(within(dialogOf()).getByRole('alert')).toHaveTextContent(
      'Доску можно передать только активному менеджеру или админу компании',
    );
  });
});
