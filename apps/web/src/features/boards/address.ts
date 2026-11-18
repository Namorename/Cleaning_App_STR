import { z } from 'zod';

/**
 * Where a manager board stands in the address of «Задания»: `?board=<id>`
 * opens it over the technicians' board (a bare `/problems` is theirs, as it
 * always was), `shelf=archive` shows its archive, `card=<id>` opens a card
 * over it — so a card can be linked, and «Назад» closes it. `?board=mine` is
 * «Назначено мне»: the viewer's cards from every board.
 */

/** The address's name of «Назначено мне» in place of a board's id. */
export const MY_CARDS = 'mine';
export type BoardShelfView = 'board' | 'archive';

export interface BoardAddress {
  boardId: string | null;
  view: BoardShelfView;
  cardId: string | null;
}

const PARAM = { board: 'board', view: 'shelf', card: 'card' } as const;
const idSchema = z.string().uuid();

function readId(value: string | null): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readBoardAddress(params: URLSearchParams): BoardAddress {
  const named = params.get(PARAM.board);
  const boardId = named === MY_CARDS ? MY_CARDS : readId(named);
  return {
    boardId,
    view:
      boardId !== null && boardId !== MY_CARDS && params.get(PARAM.view) === 'archive'
        ? 'archive'
        : 'board',
    cardId: boardId === null ? null : readId(params.get(PARAM.card)),
  };
}

export function writeBoardAddress({ boardId, view, cardId }: BoardAddress): string {
  if (boardId === null) {
    return '';
  }
  const entries: [string, string][] = [[PARAM.board, boardId]];
  if (view === 'archive') {
    entries.push([PARAM.view, view]);
  }
  if (cardId !== null) {
    entries.push([PARAM.card, cardId]);
  }
  return new URLSearchParams(entries).toString();
}

/** The address of a board, or of the technicians' board for null. */
export function boardHref(boardId: string | null): string {
  const query = writeBoardAddress({ boardId, view: 'board', cardId: null });
  return query === '' ? '/problems' : `/problems?${query}`;
}
