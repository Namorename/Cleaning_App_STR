import { ImageMetadataError, stripJpegMetadata } from '@str-ops/shared';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { TusSource } from './tus';

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

/**
 * A captured file read a piece at a time, for a resumable upload: a video is
 * never held whole in the app's memory (docs/tech-plan.md §7.5). On a phone
 * through a file handle, each read seeking first; in the browser build a blob
 * URL, sliced.
 */
export async function openFileChunks(uri: string): Promise<TusSource> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    return {
      size: blob.size,
      read: async (offset, length) =>
        new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
      close: () => undefined,
    };
  }
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  return {
    size: file.size,
    read: async (offset, length) => {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close: () => handle.close(),
  };
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
 *
 * The move is awaited, and that is the whole point of this function being
 * async. `File.move()` became a promise in expo-file-system 56 (`moveSync()`
 * is the synchronous one), and the version that dropped it on the floor left
 * the caller reading the size of a path the file had not reached yet: on
 * Android the native move runs on a coroutine, so whether the JS thread or the
 * rename won was a coin toss. The loser got size 0, the server refused the
 * row, and the cleaner was told her file was of a kind nobody accepts.
 */
export async function keepFile(
  uri: string,
  mediaId: string,
  extension: string,
): Promise<string> {
  if (Platform.OS === 'web') {
    return uri;
  }
  const directory = new Directory(Paths.document, MEDIA_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  const kept = new File(directory, `${mediaId}.${extension}`);
  await new File(uri).move(kept);
  return kept.uri;
}

/**
 * Take out of a kept photo what a camera writes about where, when and on
 * which phone it was taken (owner's word, 2026-09-28).
 *
 * A guard, not the cure: every photo comes out of expo-image-manipulator,
 * which re-encodes it from a bare bitmap and so writes none of it (its
 * sources, read 2026-09-28). This is here for the day a manipulator version
 * or a phone's encoder writes some of it back. Run before the size is taken:
 * the row declares the size of what is uploaded.
 *
 * A file the walk cannot read is left as the manipulator wrote it — already
 * clean by construction — rather than failing the photo she has just taken.
 * A file with nothing to remove is not written again.
 */
export async function stripKeptPhoto(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    // A blob URL of the browser build; the canvas that made it writes no metadata.
    return;
  }
  const file = new File(uri);
  const bytes = await file.bytes();
  let clean: Uint8Array;
  try {
    clean = stripJpegMetadata(bytes);
  } catch (error) {
    if (error instanceof ImageMetadataError) {
      return;
    }
    throw error;
  }
  if (clean !== bytes) {
    file.write(clean);
  }
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
