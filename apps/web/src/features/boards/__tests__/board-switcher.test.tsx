import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { boardSchema, type Board } from '../schema';

const LIVE = 'b0a2d100-0000-4000-8000-000000000001';
const OTHER = 'b0a2d100-0000-4000-8000-000000000002';
const SHELVED = 'b0a2d100-0000-4000-8000-000000000003';

const board = (id: string, title: string, archived_at: string | null = null): Board =>
  boardSchema.parse({
    id,
    title,
    owner_id: 'owner',
    archived_at,
    created_at: '2026-11-01T10:00:00Z',
    owner: { full_name: 'Ольга' },
  });

const BOARDS = [
  board(LIVE, 'Проекты'),
  board(OTHER, 'Закупки'),
  board(SHELVED, 'Лето 2026', '2026-11-10T10:00:00Z'),
];
const push = vi.fn();
const saveBoard = vi.fn();

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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { BoardSwitcher } from '../board-switcher';

afterEach(() => vi.clearAllMocks());

describe('the switcher of «Задания»', () => {
  test("the technicians' board first, then the live boards; one click each", () => {
    render(<BoardSwitcher activeId={null} />);
    const nav = screen.getByRole('navigation', { name: 'Доски' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Задания техников',
      'Проекты',
      'Закупки',
    ]);
    expect(links[0]).toHaveAttribute('href', '/problems');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[1]).toHaveAttribute('href', `/problems?board=${LIVE}`);
  });

  test('the open board is the current one', () => {
    render(<BoardSwitcher activeId={OTHER} />);
    expect(screen.getByRole('link', { name: 'Закупки' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Задания техников' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  test('an archived board waits under «Архив досок» and opens from there', async () => {
    const user = userEvent.setup();
    render(<BoardSwitcher activeId={null} />);
    expect(screen.queryByRole('link', { name: 'Лето 2026' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Архив досок/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Лето 2026' }));
    expect(push).toHaveBeenCalledWith(`/problems?board=${SHELVED}`);
  });

  test('«Новая доска» makes a board under an id of its own and opens it', async () => {
    const user = userEvent.setup();
    render(<BoardSwitcher activeId={null} />);
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
});
