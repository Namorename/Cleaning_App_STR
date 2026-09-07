import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { CapturedMedia } from './capture';

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
});

const storeSchema = z.record(z.string(), recordSchema);

export type LocalMediaRecord = z.infer<typeof recordSchema>;
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
    if (raw === null) {
      return {};
    }
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function saveLocalMedia(store: LocalMediaStore): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function toLocalRecord(captured: CapturedMedia): LocalMediaRecord {
  return {
    id: captured.id,
    kind: captured.kind,
    uri: captured.uri,
    mimeType: captured.mimeType,
    byteSize: captured.byteSize,
    width: captured.width,
    height: captured.height,
    durationSec: captured.durationSec,
    takenAt: captured.takenAt,
  };
}

export async function rememberLocalMedia(record: LocalMediaRecord): Promise<LocalMediaStore> {
  const store = { ...(await loadLocalMedia()), [record.id]: record };
  await saveLocalMedia(store);
  return store;
}

export async function forgetLocalMedia(mediaId: string): Promise<LocalMediaStore> {
  const { [mediaId]: _forgotten, ...rest } = await loadLocalMedia();
  await saveLocalMedia(rest);
  return rest;
}
