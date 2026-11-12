import type { SignedFile } from '@/lib/media';

import type { ViewerItem } from './viewer-item';

/** What the viewer can show of one file. */
export type FileState =
  | { status: 'loading' }
  /** A photo: an object URL of the bytes held in memory. A video: the signed link it plays. */
  | { status: 'ready'; src: string }
  /** Storage no longer has it: the retention took it. */
  | { status: 'deleted' }
  | { status: 'failed' };

export interface MediaFilesDeps {
  /** A fresh link to the file at this path. */
  sign: (path: string) => Promise<SignedFile>;
  fetchFile?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

interface Entry {
  item: ViewerItem;
  state: FileState;
  /** A fresh link has been asked for after a failure: the next failure is final. */
  hasRetried: boolean;
  /** Stops a load that is no longer wanted, and marks its answer as stale. */
  abort: AbortController;
}

const LOADING: FileState = { status: 'loading' };
const DELETED: FileState = { status: 'deleted' };
const FAILED: FileState = { status: 'failed' };

/**
 * The files the viewer holds, kept in memory and nowhere else.
 *
 * A file gets its link when it is opened, never from the list: a list read an
 * hour ago holds links that have run out. A photo is fetched past the
 * browser's cache (`no-store`) and held as an object URL, so a signed link
 * never sits on disk; a video is handed its link and streams.
 *
 * A link that fails is asked for again once — it may simply have expired —
 * and the second failure is the answer. Storage saying the object is not
 * there is `deleted`, whichever attempt hears it.
 *
 * Only what `keep` names is held: the file on screen and its neighbours. The
 * rest is let go of — a load stopped, an object URL revoked — so a set of
 * forty photos never sits in memory whole.
 */
export class MediaFiles {
  private entries: ReadonlyMap<string, Entry> = new Map();
  private snapshot: ReadonlyMap<string, FileState> = new Map();
  private readonly listeners = new Set<() => void>();
  private readonly deps: Required<MediaFilesDeps>;

  constructor(deps: MediaFilesDeps) {
    this.deps = {
      fetchFile: (...args) => fetch(...args),
      createObjectUrl: (blob) => URL.createObjectURL(blob),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
      ...deps,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<string, FileState> => this.snapshot;

  /** Hold these files — the one on screen first — and let go of every other. */
  keep(items: readonly ViewerItem[]): void {
    const wanted = new Set(items.map((item) => item.id));
    const [kept, gone] = partition([...this.entries.values()], (entry) =>
      wanted.has(entry.item.id),
    );
    gone.forEach((entry) => this.release(entry));
    this.entries = new Map(kept.map((entry) => [entry.item.id, entry]));
    items.filter((item) => !this.entries.has(item.id)).forEach((item) => this.start(item));
    this.publish();
  }

  /** Start one file again from its link, as the manager asked. */
  retry(item: ViewerItem): void {
    const entry = this.entries.get(item.id);
    if (entry !== undefined) {
      this.release(entry);
    }
    this.start(item);
    this.publish();
  }

  /**
   * The player could not open the link it was given: a fresh link once, and
   * the next failure is final. An error from a link already replaced is old
   * news and changes nothing.
   */
  videoFailed(item: ViewerItem, src: string): void {
    const entry = this.entries.get(item.id);
    if (entry === undefined || entry.state.status !== 'ready' || entry.state.src !== src) {
      return;
    }
    if (entry.hasRetried) {
      this.update(entry, { state: FAILED });
      return;
    }
    const next = this.update(entry, { state: LOADING, hasRetried: true });
    void this.settle(next, this.signVideo(next));
  }

  /** The player opened its link: a later failure may ask for a fresh one again. */
  videoPlayed(item: ViewerItem): void {
    const entry = this.entries.get(item.id);
    if (entry !== undefined && entry.hasRetried) {
      this.entries = new Map(this.entries).set(item.id, { ...entry, hasRetried: false });
    }
  }

  /** Let go of everything: the viewer has closed. */
  clear(): void {
    this.entries.forEach((entry) => this.release(entry));
    this.entries = new Map();
    this.publish();
  }

  private start(item: ViewerItem): void {
    const entry: Entry = { item, state: LOADING, hasRetried: false, abort: new AbortController() };
    this.entries = new Map(this.entries).set(item.id, entry);
    const load = item.kind === 'video' ? this.signVideo(entry) : this.loadPhoto(entry);
    void this.settle(entry, load);
  }

  /** Write a load's answer, unless the file has been let go of or started again meanwhile. */
  private async settle(entry: Entry, load: Promise<FileState>): Promise<void> {
    const state = await load.catch(() => FAILED);
    const current = this.entries.get(entry.item.id);
    if (current === undefined || current.abort !== entry.abort || entry.abort.signal.aborted) {
      if (state.status === 'ready' && entry.item.kind === 'photo') {
        this.deps.revokeObjectUrl(state.src);
      }
      return;
    }
    this.update(current, { state });
  }

  private async signVideo(entry: Entry): Promise<FileState> {
    const signed = await this.deps.sign(entry.item.path);
    return signed.status === 'missing' ? DELETED : { status: 'ready', src: signed.url };
  }

  private async loadPhoto(entry: Entry): Promise<FileState> {
    const { signal } = entry.abort;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const signed = await this.deps.sign(entry.item.path);
      if (signed.status === 'missing') {
        return DELETED;
      }
      const blob = await this.fetchBlob(signed.url, signal);
      if (blob !== null) {
        return { status: 'ready', src: this.deps.createObjectUrl(blob) };
      }
    }
    return FAILED;
  }

  /** The bytes behind a link, past the browser's cache; null when the link would not give them. */
  private async fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null> {
    try {
      const response = await this.deps.fetchFile(url, { cache: 'no-store', signal });
      return response.ok ? await response.blob() : null;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return null;
    }
  }

  private update(entry: Entry, change: Partial<Pick<Entry, 'state' | 'hasRetried'>>): Entry {
    const next = { ...entry, ...change };
    this.entries = new Map(this.entries).set(entry.item.id, next);
    this.publish();
    return next;
  }

  private release(entry: Entry): void {
    entry.abort.abort();
    if (entry.state.status === 'ready' && entry.item.kind === 'photo') {
      this.deps.revokeObjectUrl(entry.state.src);
    }
  }

  private publish(): void {
    this.snapshot = new Map([...this.entries].map(([id, entry]) => [id, entry.state]));
    this.listeners.forEach((listener) => listener());
  }
}

function partition<T>(list: readonly T[], isKept: (value: T) => boolean): [T[], T[]] {
  return [list.filter(isKept), list.filter((value) => !isKept(value))];
}
