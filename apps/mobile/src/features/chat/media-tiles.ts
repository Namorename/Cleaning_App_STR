import type { LocalMediaStore } from '@/features/media/local-store';

import type { ChatMessageMedia } from './schema';

/**
 * Where a photo of a message stands, as the bubble draws it.
 *
 * `awaited` is the receiver's view of a row without a file: the sender's
 * phone registered the photo and the file has not come yet. The sender sees
 * her own queue instead: travelling, refused by the server, or expired
 * (the file waited longer than a day and the sweep marked the row).
 */
export type MessageTileStatus = 'uploaded' | 'uploading' | 'failed' | 'expired' | 'awaited';

export interface MessageTile {
  id: string;
  /** Something expo-image can show: the file on the phone, or a signed link. */
  uri: string | null;
  status: MessageTileStatus;
}

/** What this phone's own upload queue says about one photo. */
export interface OwnMediaState {
  messageId: string;
  status: 'uploading' | 'failed' | 'expired';
}

/** By media id: the photos of messages this phone is still sending or failed to. */
export type OwnMediaStates = ReadonlyMap<string, OwnMediaState>;

/**
 * The tiles of one message.
 *
 * The hole is drawn by the row, never by the declaration (docs/chat-plan.md,
 * layer 5): a row the server has is a tile; a photo still in this phone's
 * queue, not yet registered, is a tile only for the sender, from the file on
 * the phone. A message with no words and no tiles at all would be an empty
 * bubble, so it shows one grey tile — by the empty text, not by a count.
 */
export function messageTiles(
  messageId: string,
  body: string,
  rows: readonly ChatMessageMedia[],
  isOwn: boolean,
  own: OwnMediaStates,
  local: LocalMediaStore,
  urls: Readonly<Record<string, string>>,
): MessageTile[] {
  const fromRows = rows.map<MessageTile>((row) => ({
    id: row.id,
    uri: local[row.id]?.uri ?? urls[row.storage_path] ?? null,
    status:
      row.uploaded_at !== null
        ? 'uploaded'
        : isOwn
          ? (own.get(row.id)?.status ?? 'failed')
          : 'awaited',
  }));

  const known = new Set(fromRows.map((tile) => tile.id));
  const queued = isOwn
    ? [...own.entries()]
        .filter(([id, state]) => state.messageId === messageId && !known.has(id))
        .map<MessageTile>(([id, state]) => ({
          id,
          uri: local[id]?.uri ?? null,
          status: state.status,
        }))
    : [];

  const tiles = [...fromRows, ...queued];
  if (tiles.length === 0 && body.trim() === '') {
    return [{ id: `${messageId}:awaited`, uri: null, status: 'awaited' }];
  }
  return tiles;
}
