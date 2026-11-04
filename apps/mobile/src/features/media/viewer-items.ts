import type { MediaKind } from './schema';

/** A tile as a row draws it: the file, if there is anything to draw it from. */
export interface ViewerTile {
  id: string;
  /** The file on the phone, or the signed link the tile was drawn from; null while there is neither. */
  uri: string | null;
  /** A photo unless the row says otherwise: only a step collects a video. */
  kind?: MediaKind;
}

/** One file the viewer can open. */
export interface ViewerItem {
  id: string;
  kind: MediaKind;
  /** The tile's own source, so the viewer reads what the tile has already fetched. */
  uri: string;
  /** Its number in the row, counted from one, as the row's buttons say it. */
  number: number;
}

/**
 * The files of a row the viewer can open, numbered as the row numbers them.
 * A tile with nothing to draw from — a photo on its way to another phone, or
 * a link not fetched yet — has nothing to open and is left out; the files
 * after it keep their numbers, so «Фото 3 из 4» is the third tile.
 */
export function viewerItemsOf(tiles: readonly ViewerTile[]): ViewerItem[] {
  return tiles.flatMap((tile, index) =>
    tile.uri === null
      ? []
      : [{ id: tile.id, kind: tile.kind ?? 'photo', uri: tile.uri, number: index + 1 }],
  );
}
