import type { ChatMessageMedia } from './schema';

/**
 * Where a photo of a message stands, as the bubble draws it.
 *
 * `awaited` is the reader's view of a row without a file: whoever wrote the
 * message registered the photo and the file has not arrived yet. The sender
 * sees her own attempt instead — travelling, refused, or expired, because the
 * row waited longer than a day for its file and the sweep marked it.
 *
 * The mirror of `messageTiles()` on the phone
 * (`apps/mobile/src/features/chat/media-tiles.ts`). Kept separate rather than
 * shared: the phone feeds it files on disk, the panel object URLs.
 */
export type MessageTileStatus = 'uploaded' | 'uploading' | 'failed' | 'expired' | 'awaited';

export interface MessageTile {
  id: string;
  /** Something an `img` can show: a local preview, or a signed link. */
  url: string | null;
  status: MessageTileStatus;
  /** Whether the server holds a row for it, which decides what "remove" means. */
  hasRow: boolean;
  /**
   * Whether the upload can be tried again — which it can only while this panel
   * still holds the file. A refusal read back from a row after a reload is a
   * hole that can be cleared but not refilled: the browser cannot re-open a
   * file the manager picked in another session.
   */
  canRetry: boolean;
}

/** What this panel's own upload says about one photo. */
export interface OutgoingPhotoState {
  messageId: string;
  status: 'uploading' | 'failed' | 'expired';
}

/** By media id: the photos this panel is still sending, or failed to. */
export type OutgoingPhotoStates = ReadonlyMap<string, OutgoingPhotoState>;

export interface MessageTilesInput {
  messageId: string;
  body: string;
  /** The rows the embed brought, oldest first. */
  rows: readonly ChatMessageMedia[];
  isOwn: boolean;
  outgoing: OutgoingPhotoStates;
  /** Object URLs of the files this panel is uploading, by media id. */
  previews: Readonly<Record<string, string>>;
  /** Signed links, by storage path. */
  urls: ReadonlyMap<string, string>;
}

/**
 * The tiles of one message.
 *
 * The hole is drawn by the row, never by the declaration (docs/chat-plan.md,
 * layer 5): a row the server has is a tile; a photo whose registration never
 * landed is a tile only for the sender, from the file in the browser. A
 * message with no words and no tiles at all would be an empty bubble, so it
 * shows one grey tile — by the empty text, not by a count.
 */
export function messageTiles({
  messageId,
  body,
  rows,
  isOwn,
  outgoing,
  previews,
  urls,
}: MessageTilesInput): MessageTile[] {
  const fromRows = rows.map<MessageTile>((row) => {
    const status: MessageTileStatus =
      row.uploaded_at !== null
        ? 'uploaded'
        : isOwn
          ? (outgoing.get(row.id)?.status ?? 'failed')
          : 'awaited';
    return {
      id: row.id,
      url: previews[row.id] ?? urls.get(row.storage_path) ?? null,
      status,
      hasRow: true,
      canRetry: status === 'failed' && outgoing.has(row.id),
    };
  });

  const known = new Set(fromRows.map((tile) => tile.id));
  const queued = isOwn
    ? [...outgoing.entries()]
        .filter(([id, state]) => state.messageId === messageId && !known.has(id))
        .map<MessageTile>(([id, state]) => ({
          id,
          url: previews[id] ?? null,
          status: state.status,
          hasRow: false,
          canRetry: state.status === 'failed',
        }))
    : [];

  const tiles = [...fromRows, ...queued];
  if (tiles.length === 0 && body.trim() === '') {
    return [
      { id: `${messageId}:awaited`, url: null, status: 'awaited', hasRow: false, canRetry: false },
    ];
  }
  return tiles;
}
