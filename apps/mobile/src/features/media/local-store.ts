import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { CapturedMedia } from './capture';
import { storedMediaPath } from './media-path';

const STORE_KEY = 'str-ops.media-local';

const recordSchema = z.object({
  id: z.string(),
  kind: z.enum(['photo', 'video']),
  uri: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSec: z.number().nullable(),
  takenAt: z.string(),
  // Defaulted, not required: a record written by the build before this column
  // said nothing, and nothing must not become a claim of 'camera'. The server
  // reads an absent source the same way.
  source: z.enum(['camera', 'gallery']).optional(),
  // Where a resumable upload of this file stands in storage (a video's: the
  // TUS upload's address), so a retry after a dropped network, a restart or
  // the app's return from the background resumes rather than starts over.
  // Defaulted: a record of the build before it has none, and still reads.
  uploadUrl: z.string().nullable().default(null),
});

const storeSchema = z.record(z.string(), recordSchema);

/**
 * A record as it is written: `uploadUrl` may be left out — a capture has none
 * until its upload begins — and reads back as null.
 */
export type LocalMediaRecord = z.input<typeof recordSchema>;
export type LocalMediaStore = Record<string, LocalMediaRecord>;

/**
 * What the phone knows about its own captures, by media id.
 *
 * Two reasons to keep this outside the query cache. A thumbnail should come
 * from the file on the phone, not from a signed link that needs signal. And
 * an upload that failed outright (not paused — failed) is dropped from the
 * mutation cache on restart; the row then sits on the server without a file,
 * and retrying it needs the file's whereabouts and what was declared about
 * it. Unreadable content reads as empty: a corrupted store must not take the
 * step screen down.
 */
export async function loadLocalMedia(): Promise<LocalMediaStore> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    return raw === null ? {} : readLocalMediaStore(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * The ledger read by the store's rules, wherever it comes from: its own key,
 * or the query cache's copy restored from disk, which the query never reloads
 * (its staleTime is infinite) and zod never saw.
 *
 * A capture the old build measured before it had finished moving was
 * remembered as zero bytes, and the server refuses such a row every time: the
 * retry button on the step screen could only ever fail again. The record is
 * dropped instead of kept, so she is offered a fresh shot rather than a loop.
 * Nothing recoverable is lost — the size is exactly what this record failed to
 * learn. Unreadable reads as empty, as the store has always treated it.
 *
 * A file is read by its place in the documents (`storedMediaPath`): a record
 * an older build wrote with the full path of its install reads the same as one
 * written now, and the full path of this run is made where the file is used
 * (iPhone risk 1, docs/ios-first-device-checklist.md).
 */
export function readLocalMediaStore(data: unknown): LocalMediaStore {
  const parsed = storeSchema.safeParse(data);
  if (!parsed.success) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed.data)
      .filter(([, record]) => record.byteSize > 0)
      .map(([id, record]) => [id, { ...record, uri: storedMediaPath(record.uri) }]),
  );
}

async function saveLocalMedia(store: LocalMediaStore): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let writes: Promise<unknown> = Promise.resolve();

/**
 * One change of the ledger at a time. Each reads the whole store and writes
 * it back; two at once — an upload saving its address while another photo is
 * remembered — would each write what the other had not seen, and one of them
 * would be lost.
 */
function serialized<T>(change: () => Promise<T>): Promise<T> {
  const done = writes.then(change, change);
  writes = done.catch(() => undefined);
  return done;
}

export function toLocalRecord(captured: CapturedMedia): LocalMediaRecord {
  return {
    id: captured.id,
    kind: captured.kind,
    uri: storedMediaPath(captured.uri),
    mimeType: captured.mimeType,
    byteSize: captured.byteSize,
    width: captured.width,
    height: captured.height,
    durationSec: captured.durationSec,
    takenAt: captured.takenAt,
    source: captured.source,
  };
}

export function rememberLocalMedia(record: LocalMediaRecord): Promise<LocalMediaStore> {
  return serialized(async () => {
    const store = { ...(await loadLocalMedia()), [record.id]: record };
    await saveLocalMedia(store);
    return store;
  });
}

/**
 * The ledger an older build wrote with full paths, written again with each
 * file's place in the documents (iPhone risk 1) — once, at the start: every
 * record is kept as the store reads it, and a ledger with nothing to move, or
 * one that cannot be read, is not written at all.
 */
export function migrateLocalMediaStore(): Promise<void> {
  return serialized(async () => {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw === null) {
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = storeSchema.safeParse(data);
    const isMoved =
      parsed.success &&
      Object.values(parsed.data).some((record) => record.uri !== storedMediaPath(record.uri));
    if (isMoved) {
      await saveLocalMedia(readLocalMediaStore(data));
    }
  });
}

export function forgetLocalMedia(mediaId: string): Promise<LocalMediaStore> {
  return serialized(async () => {
    const { [mediaId]: _forgotten, ...rest } = await loadLocalMedia();
    await saveLocalMedia(rest);
    return rest;
  });
}

/**
 * Keep the address of a capture's resumable upload — or let go of it (null)
 * once the storage says it has expired. A capture the phone does not
 * remember gets no record of its own from this.
 */
export function rememberUploadUrl(mediaId: string, uploadUrl: string | null): Promise<void> {
  return serialized(async () => {
    const store = await loadLocalMedia();
    const record = store[mediaId];
    if (record === undefined) {
      return;
    }
    await saveLocalMedia({ ...store, [mediaId]: { ...record, uploadUrl } });
  });
}
