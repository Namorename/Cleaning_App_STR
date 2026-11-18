import { BOARD_COLUMNS, BOARD_ENTRY_KINDS, canWorkOnCard, propertyPathOf } from '@str-ops/shared';
import { z } from 'zod';

/**
 * Manager boards as the panel reads them (20261118200000,
 * docs/manager-boards.md). The rows are the tables' own; every write goes
 * through the board functions, which answer the row they wrote.
 */

const personSchema = z.object({ full_name: z.string().nullable() }).nullable();

const placeSchema = z
  .object({
    name: z.string(),
    hostaway_unit_id: z.number().nullable(),
    parent: z.object({ name: z.string() }).nullable(),
  })
  .nullable();

export const boardSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner_id: z.string(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  owner: personSchema,
});
export type Board = z.infer<typeof boardSchema>;
export const boardListSchema = z.array(boardSchema);

export const columnSchema = z.enum(BOARD_COLUMNS);

/** A step as the board reads it: enough for the progress and the search. */
const stepMarkSchema = z.object({
  id: z.string(),
  body: z.string(),
  done_at: z.string().nullable(),
});

export const boardCardSchema = z.object({
  id: z.string(),
  board_id: z.string(),
  title: z.string(),
  description: z.string(),
  column_key: columnSchema,
  color: z.string().nullable(),
  due_on: z.string().nullable(),
  property_id: z.number().nullable(),
  created_at: z.string(),
  moved_at: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  property: placeSchema,
  steps: z.array(stepMarkSchema),
  // Who works on it (20261118230000): an active manager or admin, or nobody.
  assignee_id: z.string().nullable().default(null),
  assignee: personSchema.default(null),
});
export type BoardCard = z.infer<typeof boardCardSchema>;
export const boardCardListSchema = z.array(boardCardSchema);

/** A card of «Назначено мне», from any board that is not archived: with its board's name and rights. */
export const myCardSchema = boardCardSchema.extend({
  board: z.object({
    id: z.string(),
    title: z.string(),
    owner_id: z.string(),
    archived_at: z.string().nullable(),
  }),
});
export type MyCard = z.infer<typeof myCardSchema>;
export const myCardListSchema = z.array(myCardSchema);

/** A person of the company: the journal names anybody; a card goes to `assignablePeople` only. */
export const officePersonSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  role: z.string(),
  is_active: z.boolean(),
});
export type OfficePerson = z.infer<typeof officePersonSchema>;
export const officePeopleSchema = z.array(officePersonSchema);

/** Who a card can be given to: the company's active managers and admins (the server's rule). */
export function assignablePeople(people: readonly OfficePerson[]): OfficePerson[] {
  return people.filter(
    (person) => person.is_active && (person.role === 'manager' || person.role === 'admin'),
  );
}

export const cardStepSchema = stepMarkSchema.extend({ sort_order: z.number() });
export type CardStep = z.infer<typeof cardStepSchema>;

export const cardEntrySchema = z.object({
  id: z.string(),
  // A string, not the known kinds: a kind a later server adds (or one an older panel in a tab
  // left open does not know) is a line skipped, not a card that cannot be opened.
  kind: z.string(),
  body: z.string().nullable(),
  facts: z.record(z.string(), z.unknown()),
  author_id: z.string().nullable(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  author: personSchema,
});
export type CardEntry = z.infer<typeof cardEntrySchema>;

export const cardDetailSchema = boardCardSchema.extend({
  created_by: z.string(),
  creator: personSchema,
  steps: z.array(cardStepSchema),
  entries: z.array(cardEntrySchema),
});
export type CardDetail = z.infer<typeof cardDetailSchema>;

/** Where a card stands: on the board, in the archive, or among the deleted. */
export type CardShelf = 'active' | 'archived' | 'deleted';

export function shelfOf(card: Pick<BoardCard, 'archived_at' | 'deleted_at'>): CardShelf {
  if (card.deleted_at !== null) {
    return 'deleted';
  }
  return card.archived_at !== null ? 'archived' : 'active';
}

/** The card's place in one line, or null when it has none. */
export function cardPlace(card: Pick<BoardCard, 'property'>): string | null {
  return propertyPathOf(card.property);
}

/** A card's steps in their order on the card. */
export function orderedSteps(steps: readonly CardStep[]): CardStep[] {
  return [...steps].sort((left, right) => left.sort_order - right.sort_order);
}

/** A card's journal lines this panel can say, oldest first: the order the server wrote them in. */
export function orderedEntries(entries: readonly CardEntry[]): CardEntry[] {
  return entries
    .filter((entry) => (BOARD_ENTRY_KINDS as readonly string[]).includes(entry.kind))
    .sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
    );
}

/**
 * Who may change a board: its owner and an admin (the server says the same,
 * manager_board_for_edit). Another manager reads it.
 */
export interface BoardViewer {
  id: string;
  isAdmin: boolean;
}

export function canEditBoard(
  board: Pick<Board, 'owner_id' | 'archived_at'>,
  viewer: BoardViewer,
): boolean {
  return board.archived_at === null && (viewer.isAdmin || board.owner_id === viewer.id);
}

/**
 * May the viewer work on this card — its fields, due date, steps, journal and column? The board's
 * owner, an admin, and the card's assignee (20261118230000), never on an archived board. The board
 * itself, a card's shelf and copy and the assignment stay `canEditBoard`'s.
 */
export function canWorkOn(
  board: Pick<Board, 'owner_id' | 'archived_at'>,
  card: Pick<BoardCard, 'assignee_id'>,
  viewer: BoardViewer,
): boolean {
  return canWorkOnCard(board, card, viewer);
}

/** Two letters of a person's name for a card's corner: «Анна Новак» → «АН». */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? '')
    .join('');
}

/** May the viewer change this comment's words? Only its author. */
export function canEditComment(
  entry: Pick<CardEntry, 'kind' | 'author_id'>,
  viewer: BoardViewer,
): boolean {
  return entry.kind === 'comment' && entry.author_id === viewer.id;
}

/** May the viewer delete it? Its author, or an admin. */
export function canDeleteComment(
  entry: Pick<CardEntry, 'kind' | 'author_id'>,
  viewer: BoardViewer,
): boolean {
  return entry.kind === 'comment' && (entry.author_id === viewer.id || viewer.isAdmin);
}
