import type { MediaKind } from './schema';

/**
 * One file the viewer can show: what it is and where it lies, never a link.
 *
 * A link is asked for when the file is opened (`MediaFiles`), so a list read
 * an hour ago does not hand the viewer a link that has run out.
 */
export interface ViewerItem {
  id: string;
  kind: MediaKind;
  /** Where the file lies in the private bucket. */
  path: string;
  /** When the row was made: the time shown, and the name a download is saved as. */
  createdAt: string;
  /** The phone's own timer on a video; null when it said nothing. */
  durationSec?: number | null;
}

/** The extension a file without one is saved with. */
const FALLBACK_EXTENSION: Record<MediaKind, string> = { photo: 'jpg', video: 'mp4' };

const pad = (value: number): string => value.toString().padStart(2, '0');

/** The path's own extension, lower case; null when it has none worth keeping. */
function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const extension = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : null;
}

/**
 * The name a downloaded file is saved as: what it is, when it was taken (the
 * browser's own clock), and its place in the set — `photo-2026-11-12-1430-3.jpg`.
 *
 * Latin letters and digits only: storage writes the name into a header, and
 * a step's name in Czech or Russian would not survive every browser there.
 */
export function downloadName(item: ViewerItem, position: number): string {
  const at = new Date(item.createdAt);
  const extension = extensionOf(item.path) ?? FALLBACK_EXTENSION[item.kind];
  if (Number.isNaN(at.getTime())) {
    return `${item.kind}-${position}.${extension}`;
  }
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${item.kind}-${day}-${time}-${position}.${extension}`;
}
