/**
 * How far each video upload of this run has got: the share of its file the
 * storage holds, 0 to 1, by media id.
 *
 * Kept apart from the query client on purpose. The queue's mutations know
 * only "pending" or not; the share changes with every piece, means nothing
 * after a restart (the storage is asked again then), and is never written to
 * disk. The step's tiles read it through `useUploadProgress`.
 */
export type UploadProgress = Readonly<Record<string, number>>;

let current: UploadProgress = {};
const listeners = new Set<() => void>();

function publish(next: UploadProgress): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function reportUploadProgress(mediaId: string, sent: number, total: number): void {
  const share = total > 0 ? Math.min(1, Math.max(0, sent / total)) : 1;
  if (current[mediaId] !== share) {
    publish({ ...current, [mediaId]: share });
  }
}

/** Forget an upload's share once it has arrived. */
export function clearUploadProgress(mediaId: string): void {
  if (mediaId in current) {
    const { [mediaId]: _arrived, ...rest } = current;
    publish(rest);
  }
}

export function subscribeUploadProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same object until something changes, as useSyncExternalStore needs. */
export function uploadProgressSnapshot(): UploadProgress {
  return current;
}
