import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { boardSchema, type Board } from '../schema';

const LIVE = 'b0a2d100-0000-4000-8000-000000000001';
const OTHER = 'b0a2d100-0000-4000-8000-000000000002';
const SHELVED = 'b0a2d100-0000-4000-8000-000000000003';
const GONE = 'b0a2d100-0000-4000-8000-0000000000ff';

const board = (id: string, title: string, archived_at: string | null = null): Board =>
  boardSchema.parse({
    id,
    title,
    owner_id: 'owner',
    archived_at,
    created_at: '2026-11-01T10:00:00Z',
    shared: true,
    owner: { full_name: 'Ольга' },
  });

const BOARDS = [
  board(LIVE, 'Проекты'),
  board(OTHER, 'Закупки'),
  board(SHELVED, 'Лето 2026', '2026-11-10T10:00:00Z'),
];
const push = vi.fn();
const saveBoard = vi.fn();

/** The person's order as the server keeps it; a save that is to fail says so. */
const server: { order: string[] | null; failSave: boolean } = { order: null, failSave: false };
const fetchBoardTabOrder = vi.fn(async () => server.order);
const saveBoardTabOrder = vi.fn(async (_client: unknown, tabIds: readonly string[]) => {
  if (server.failSave) {
    throw Object.assign(new Error('could not save'), { code: '08006' });
  }
  server.order = [...tabIds];
  return server.order;
});

vi.mock('../use-boards', () => ({
  useBoards: () => ({ isPending: false, isError: false, data: BOARDS }),
  useSaveBoard: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (variables: unknown, options?: { onSuccess?: () => void }) => {
      saveBoard(variables);
      options?.onSuccess?.();
    },
  }),
}));

vi.mock('../tab-order-api', () => ({
  fetchBoardTabOrder: () => fetchBoardTabOrder(),
  saveBoardTabOrder: (client: unknown, tabIds: readonly string[]) =>
    saveBoardTabOrder(client, tabIds),
}));

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// A plain link: the test reads whether a click was let through (no router to follow it here).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BoardSwitcher } from '../board-switcher';
import { TAB_ORDER_SAVE_DELAY_MS } from '../use-tab-order';

function show(activeId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BoardSwitcher activeId={activeId} viewerId="viewer-1" />
    </QueryClientProvider>,
  );
}

const row = () => screen.getByRole('navigation', { name: 'Доски' });
const tabNames = () =>
  within(row())
    .getAllByRole('link')
    .map((link) => link.textContent);
const tab = (name: string) => within(row()).getByRole('link', { name });

/** Clicks a tab and answers whether the click was let through to open the board. */
function clickOpens(link: HTMLElement): boolean {
  let opens = false;
  // After React's own handlers: read the verdict, then keep jsdom from following the link.
  const listen = (event: Event) => {
    opens = !event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('click', listen);
  fireEvent.click(link);
  window.removeEventListener('click', listen);
  return opens;
}

/** Waits until the person's order has been read and applied. */
async function settled() {
  await waitFor(() => expect(fetchBoardTabOrder).toHaveBeenCalled());
  await act(async () => {});
}

/**
 * A drag as a browser makes it: the tab picked up, held over another tab on one side of its middle
 * (jsdom has no DragEvent: a mouse event of the type carries the pointer), let go over the row.
 */
function drag(from: string, to: string, side: 'before' | 'after') {
  const source = tab(from);
  const target = tab(to);
  target.getBoundingClientRect = () =>
    ({
      left: 100,
      right: 200,
      top: 0,
      bottom: 44,
      width: 100,
      height: 44,
      x: 100,
      y: 0,
    }) as DOMRect;
  fireEvent.dragStart(source);
  act(() => {
    target.dispatchEvent(
      new MouseEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: side === 'before' ? 110 : 190,
      }),
    );
  });
  fireEvent.drop(row());
  fireEvent.dragEnd(source);
}

beforeEach(() => {
  server.order = null;
  server.failSave = false;
});

afterEach(() => vi.clearAllMocks());

describe('the switcher of «Задания»', () => {
  test("the technicians' board first, then «Назначено мне», then the live boards; one click each", async () => {
    show();
    await settled();
    const links = within(row()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Задания техников',
      'Назначено мне',
      'Проекты',
      'Закупки',
    ]);
    expect(links[0]).toHaveAttribute('href', '/problems');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[1]).toHaveAttribute('href', '/problems?board=mine');
    expect(links[2]).toHaveAttribute('href', `/problems?board=${LIVE}`);
  });

  test('the open board is the current one', async () => {
    show(OTHER);
    await settled();
    expect(tab('Закупки')).toHaveAttribute('aria-current', 'page');
    expect(tab('Задания техников')).not.toHaveAttribute('aria-current');
  });

  test('an archived board waits under «Архив досок» and opens from there', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole('link', { name: 'Лето 2026' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Архив досок/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Лето 2026' }));
    expect(push).toHaveBeenCalledWith(`/problems?board=${SHELVED}`);
  });

  test('«Новая доска» makes a board under an id of its own and opens it', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Новая доска' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Название доски' }),
      'Ремонт на Виноградской',
    );
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    const [{ boardId, title }] = saveBoard.mock.calls[0] as [{ boardId: string; title: string }];
    expect(title).toBe('Ремонт на Виноградской');
    expect(push).toHaveBeenCalledWith(`/problems?board=${boardId}`);
  });

  // Who sees a new board (20261126120000): its maker alone, unless she says otherwise.
  test('a new board is its maker’s alone by default', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Новая доска' }));
    const group = screen.getByRole('group', { name: 'Кто видит доску' });
    expect(within(group).getByRole('radio', { name: 'Видна только мне' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Видна другим менеджерам' })).not.toBeChecked();
    await user.type(screen.getByRole('textbox', { name: 'Название доски' }), 'Личное');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    expect(saveBoard).toHaveBeenCalledWith(expect.objectContaining({ shared: false }));
  });

  test('a new board shared with the other managers says so', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Новая доска' }));
    await user.click(screen.getByRole('radio', { name: 'Видна другим менеджерам' }));
    await user.type(screen.getByRole('textbox', { name: 'Название доски' }), 'Общая');
    await user.click(screen.getByRole('button', { name: 'Создать' }));
    expect(saveBoard).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Общая', shared: true }),
    );
  });
});

// Owner, 2026-11-26: the board tabs in the person's own order (20261126160000).
describe('the person’s own order of the tabs', () => {
  test('her saved order stands; «Новая доска» and «Архив досок» stay at the end', async () => {
    server.order = [OTHER, 'mine', 'tech', LIVE];
    show();
    await waitFor(() =>
      expect(tabNames()).toEqual(['Закупки', 'Назначено мне', 'Задания техников', 'Проекты']),
    );
    const buttons = within(row()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Новая доска',
      expect.stringContaining('Архив досок'),
    ]);
    expect(within(row()).getAllByRole('link').at(-1)?.nextElementSibling).toBe(buttons[0]);
    expect(buttons[0]).not.toHaveAttribute('draggable', 'true');
  });

  test('a board her order does not name — a new one — goes last, before the buttons', async () => {
    server.order = [OTHER, 'tech', 'mine'];
    show();
    await waitFor(() =>
      expect(tabNames()).toEqual(['Закупки', 'Задания техников', 'Назначено мне', 'Проекты']),
    );
  });

  test('a board she no longer has, or never had, is passed over without a word', async () => {
    server.order = [SHELVED, GONE, OTHER, LIVE];
    show();
    await waitFor(() =>
      expect(tabNames()).toEqual(['Закупки', 'Проекты', 'Задания техников', 'Назначено мне']),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('an order that cannot be read leaves the tabs as they always stood, still, and says nothing', async () => {
    fetchBoardTabOrder.mockRejectedValueOnce(new Error('no such table'));
    show();
    await settled();
    expect(tabNames()).toEqual(['Задания техников', 'Назначено мне', 'Проекты', 'Закупки']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A move on the default order would overwrite the one that could not be read.
    expect(tab('Проекты')).toHaveAttribute('draggable', 'false');
    expect(tab('Проекты')).not.toHaveAccessibleDescription(/Вкладки досок можно перетащить/);
  });

  test('until her order is read the tabs stand still; then they move', async () => {
    let answer: (order: string[] | null) => void = () => {};
    fetchBoardTabOrder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    show();
    await waitFor(() => expect(fetchBoardTabOrder).toHaveBeenCalled());
    expect(tab('Проекты')).toHaveAttribute('draggable', 'false');
    fireEvent.keyDown(tab('Проекты'), { key: ' ' });
    expect(screen.getByRole('status')).toHaveTextContent('');

    await act(async () => answer([OTHER, 'tech']));
    await waitFor(() => expect(tab('Проекты')).toHaveAttribute('draggable', 'true'));
  });

  test('every tab is draggable, «Задания техников» and «Назначено мне» too, and says how', async () => {
    show();
    await settled();
    for (const link of within(row()).getAllByRole('link')) {
      expect(link).toHaveAttribute('draggable', 'true');
      expect(link).toHaveAccessibleDescription(/Вкладки досок можно перетащить/);
    }
  });

  test('a dragged tab takes its new place at once; the order is saved a moment later', async () => {
    show();
    await settled();

    drag('Закупки', 'Задания техников', 'before');

    expect(tabNames()).toEqual(['Закупки', 'Задания техников', 'Назначено мне', 'Проекты']);
    expect(saveBoardTabOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1), {
      timeout: TAB_ORDER_SAVE_DELAY_MS * 4,
    });
    expect(saveBoardTabOrder.mock.calls[0][1]).toEqual([OTHER, 'tech', 'mine', LIVE]);
  });

  test('the side of the tab under the pointer decides: after it', async () => {
    show();
    await settled();

    drag('Задания техников', 'Проекты', 'after');

    expect(tabNames()).toEqual(['Назначено мне', 'Проекты', 'Задания техников', 'Закупки']);
  });

  test('moves in a row are one save, of the last order', async () => {
    show();
    await settled();

    drag('Закупки', 'Задания техников', 'before');
    drag('Проекты', 'Закупки', 'before');

    expect(tabNames()).toEqual(['Проекты', 'Закупки', 'Задания техников', 'Назначено мне']);
    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1), {
      timeout: TAB_ORDER_SAVE_DELAY_MS * 4,
    });
    expect(saveBoardTabOrder.mock.calls[0][1]).toEqual([LIVE, OTHER, 'tech', 'mine']);
  });

  test('a drag let go outside the row, or called off, changes nothing', async () => {
    show();
    await settled();
    const source = tab('Закупки');
    const target = tab('Задания техников');
    target.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 200,
        top: 0,
        bottom: 44,
        width: 100,
        height: 44,
        x: 100,
        y: 0,
      }) as DOMRect;
    fireEvent.dragStart(source);
    act(() => {
      target.dispatchEvent(
        new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 110 }),
      );
    });
    expect(tabNames()[0]).toBe('Закупки');
    fireEvent.dragEnd(source);

    expect(tabNames()).toEqual(['Задания техников', 'Назначено мне', 'Проекты', 'Закупки']);
    await new Promise((resolve) => setTimeout(resolve, TAB_ORDER_SAVE_DELAY_MS * 2));
    expect(saveBoardTabOrder).not.toHaveBeenCalled();
  });

  test('a plain click opens the board; the click a drag leaves behind does not', async () => {
    show();
    await settled();

    expect(clickOpens(tab('Проекты'))).toBe(true);

    drag('Закупки', 'Задания техников', 'before');
    expect(clickOpens(tab('Закупки'))).toBe(false);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(clickOpens(tab('Закупки'))).toBe(true);
  });

  test('a save that fails brings the saved order back and says so', async () => {
    server.order = ['mine', 'tech', LIVE, OTHER];
    show();
    await waitFor(() =>
      expect(tabNames()).toEqual(['Назначено мне', 'Задания техников', 'Проекты', 'Закупки']),
    );
    server.failSave = true;

    drag('Закупки', 'Назначено мне', 'before');
    expect(tabNames()[0]).toBe('Закупки');

    expect(
      await screen.findByRole('alert', {}, { timeout: TAB_ORDER_SAVE_DELAY_MS * 4 }),
    ).toHaveTextContent('Порядок досок не сохранился — вернули прежний.');
    expect(tabNames()).toEqual(['Назначено мне', 'Задания техников', 'Проекты', 'Закупки']);
  });

  test('from the keyboard: Space picks a tab up, the arrows move it, Space puts it down', async () => {
    const user = userEvent.setup();
    show();
    await settled();

    tab('Проекты').focus();
    await user.keyboard(' ');
    expect(screen.getByRole('status')).toHaveTextContent('«Проекты» взята: место 3 из 4.');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabNames()).toEqual(['Проекты', 'Задания техников', 'Назначено мне', 'Закупки']);
    expect(screen.getByRole('status')).toHaveTextContent('«Проекты»: место 1 из 4');
    expect(tab('Проекты')).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('status')).toHaveTextContent('«Проекты» поставлена: место 1 из 4');

    await waitFor(() => expect(saveBoardTabOrder).toHaveBeenCalledTimes(1), {
      timeout: TAB_ORDER_SAVE_DELAY_MS * 4,
    });
    expect(saveBoardTabOrder.mock.calls[0][1]).toEqual([LIVE, 'tech', 'mine', OTHER]);
  });

  test('Escape puts a picked tab back where it was, and Enter does not open it while it is held', async () => {
    const user = userEvent.setup();
    show();
    await settled();

    tab('Задания техников').focus();
    await user.keyboard(' {ArrowRight}{ArrowRight}');
    expect(tabNames()[2]).toBe('Задания техников');
    await user.keyboard('{Escape}');

    expect(tabNames()).toEqual(['Задания техников', 'Назначено мне', 'Проекты', 'Закупки']);
    expect(screen.getByRole('status')).toHaveTextContent('«Задания техников» осталась на месте');

    await user.keyboard(' {ArrowRight}');
    const held = tab('Задания техников');
    expect(fireEvent.keyDown(held, { key: 'Enter' })).toBe(false);
    expect(tabNames()).toEqual(['Назначено мне', 'Задания техников', 'Проекты', 'Закупки']);
  });
});
