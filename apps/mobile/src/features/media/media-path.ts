import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** Where a capture is kept until the server has it: a folder of the app's documents. */
export const KEPT_MEDIA_DIRECTORY = 'task-media';

const KEPT_PREFIX = `${KEPT_MEDIA_DIRECTORY}/`;
const FILE_SCHEME = 'file://';

/**
 * The name of a kept file, from the place it is remembered by or from a full
 * path of any install; null for anything that is not one of ours — a capture
 * still in the cache, a signed link, a blob of the browser build.
 */
function keptName(uri: string): string | null {
  let name: string;
  if (uri.startsWith(KEPT_PREFIX)) {
    name = uri.slice(KEPT_PREFIX.length);
  } else if (uri.startsWith(FILE_SCHEME)) {
    const at = uri.lastIndexOf(`/${KEPT_PREFIX}`);
    if (at < 0) {
      return null;
    }
    name = uri.slice(at + KEPT_PREFIX.length + 1);
  } else {
    return null;
  }
  return name !== '' && !name.includes('/') ? name : null;
}

/**
 * What is remembered of a file — on disk, in the ledger of captures and in the
 * upload queue: a kept file by its place in the documents, `task-media/<id>.<ext>`;
 * anything else as it is.
 *
 * Not the full path (iPhone risk 1, docs/ios-first-device-checklist.md): an
 * iPhone's documents live in a folder named after the install,
 * `…/Application/<UUID>/Documents/`, and a new build may be given another.
 * The files move with the documents; a full path remembered before does not.
 */
export function storedMediaPath(uri: string): string {
  const name = keptName(uri);
  return name === null ? uri : `${KEPT_PREFIX}${name}`;
}

/**
 * The full path of a file at the moment it is used — read, uploaded, removed
 * or drawn: a kept file in the documents of this run, whether it was
 * remembered by its place or, by a build before this one, by the full path of
 * another install. Anything else is used as it is. On Android the documents
 * do not move, and a full path comes back the same; the browser build has no
 * documents, and its blob URLs are never ours to move.
 */
export function mediaFileUri(path: string): string {
  if (Platform.OS === 'web') {
    return path;
  }
  const name = keptName(path);
  if (name === null) {
    return path;
  }
  return new File(new Directory(Paths.document, KEPT_MEDIA_DIRECTORY), name).uri;
}
