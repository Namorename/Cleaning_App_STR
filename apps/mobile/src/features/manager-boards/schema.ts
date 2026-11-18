import { BOARD_ENTRY_KINDS, canWorkOnCard, propertyPathOf } from '@str-ops/shared';
import { z } from 'zod';

/**
 * Manager boards as the office's phone reads them (20261118200000,
 * docs/manager-boards.md). The same rows as the panel's; every write is one of
 * the board functions. Read through these schemas on the way out of the cache
 * (`readCached`), as every list of the phone is.
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
  // A string, not the four: a column a later server adds leaves this phone's lists readable
  // (the card simply stands in no column it shows) instead of failing the whole read.
  column_key: z.string(),
  color: z.string().nullable(),
  due_on: z.string().nullable(),
  property_id: z.number().nullable(),
  created_at: z.string(),
  moved_at: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  property: placeSchema,
  steps: z.array(stepMarkSchema),
  // Who works on it (20261118230000). Defaults: a card saved to disk by the build before it.
  assignee_id: z.string().nullable().default(null),
  assignee: personSchema.default(null),
});
export type BoardCard = z.infer<typeof boardCardSchema>;
export const boardCardListSchema = z.array(boardCardSchema);

/** A card of «Назначено мне», from any board that is not archived, with its board's name. */
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

export const cardStepSchema = stepMarkSchema.extend({ sort_order: z.number() });
export type CardStep = z.infer<typeof cardStepSchema>;

export const cardEntrySchema = z.object({
  id: z.string(),
  // A string for the same reason: a kind a later server adds is a line this phone skips.
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
export const oneCardSchema = cardDetailSchema.nullable();

export type CardShelf = 'active' | 'archived' | 'deleted';

export function shelfOf(card: Pick<BoardCard, 'archived_at' | 'deleted_at'>): CardShelf {
  if (card.deleted_at !== null) {
    return 'deleted';
  }
  return card.archived_at !== null ? 'archived' : 'active';
}

export function cardPlace(card: Pick<BoardCard, 'property'>): string | null {
  return propertyPathOf(card.property);
}

export function orderedSteps(steps: readonly CardStep[]): CardStep[] {
  return [...steps].sort((left, right) => left.sort_order - right.sort_order);
}

/** The journal's lines this build can say, oldest first: the order the server wrote them in. */
export function orderedEntries(entries: readonly CardEntry[]): CardEntry[] {
  return entries
    .filter((entry) => (BOARD_ENTRY_KINDS as readonly string[]).includes(entry.kind))
    .sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
    );
}

/** Who looks: their id, and whether they are an admin (the server says the same). */
export interface BoardViewer {
  id: string;
  isAdmin: boolean;
}

/** The owner and an admin change a board that is not archived; another manager reads it. */
export function canEditBoard(
  board: Pick<Board, 'owner_id' | 'archived_at'>,
  viewer: BoardViewer,
): boolean {
  return board.archived_at === null && (viewer.isAdmin || board.owner_id === viewer.id);
}

/**
 * Who works on a card — its fields and due date, steps, journal, column: the board's owner, an
 * admin, and the card's assignee (20261118230000). The board, a card's shelf and copy and the
 * assignment stay `canEditBoard`'s. The server checks the same.
 */
export function canWorkOn(
  board: Pick<Board, 'owner_id' | 'archived_at'>,
  card: Pick<BoardCard, 'assignee_id'>,
  viewer: BoardViewer,
): boolean {
  return canWorkOnCard(board, card, viewer);
}

/** A person of the company's directory, as a card's assignee is picked and named. */
export interface OfficePerson {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

/** Who a card can be given to: the company's active managers and admins, by name. */
export function assignablePeople(staff: readonly OfficePerson[]): OfficePerson[] {
  return staff
    .filter((person) => person.is_active && (person.role === 'manager' || person.role === 'admin'))
    .sort((left, right) => (left.full_name ?? '').localeCompare(right.full_name ?? ''));
}

/** Its author changes a comment. */
export function canEditComment(
  entry: Pick<CardEntry, 'kind' | 'author_id'>,
  viewer: BoardViewer,
): boolean {
  return entry.kind === 'comment' && entry.author_id === viewer.id;
}

/** Its author or an admin deletes it; a system line nobody does. */
export function canDeleteComment(
  entry: Pick<CardEntry, 'kind' | 'author_id'>,
  viewer: BoardViewer,
): boolean {
  return entry.kind === 'comment' && (entry.author_id === viewer.id || viewer.isAdmin);
}
