import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * The bytes of a captured file, ready for upload.
 *
 * On a phone the file is read through expo-file-system; in the browser build
 * (development and the driven test run) the picker hands over a blob URL,
 * which only fetch can read.
 */
export async function readFileBytes(uri: string): Promise<ArrayBuffer | Blob> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.blob();
  }
  return new File(uri).arrayBuffer();
}

/** Size in bytes, the way the server wants it declared before the upload. */
export async function fileSize(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return (await response.blob()).size;
  }
  return new File(uri).size ?? 0;
}

const MEDIA_DIRECTORY = 'task-media';

/**
 * Move a capture out of the cache, where the system may clear it before the
 * upload gets its turn, into the app's own documents under a name of ours.
 *
 * Returns the new uri. The browser has no such place; its blob URL is
 * returned as it is.
 */
export function keepFile(uri: string, mediaId: string, extension: string): string {
  if (Platform.OS === 'web') {
    return uri;
  }
  const directory = new Directory(Paths.document, MEDIA_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  const kept = new File(directory, `${mediaId}.${extension}`);
  new File(uri).move(kept);
  return kept.uri;
}

/** Remove a kept file; a file already gone is not an error. */
export function discardFile(uri: string): void {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // The file is gone already, or the system took the directory: nothing to do.
  }
}
