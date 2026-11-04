/**
 * The PMS's page of a month, kept by one instance of guest-review-text so
 * that reading several reviews of the same month asks Hostaway once
 * (docs/guest-review-text.md §2).
 *
 * - Memory only: nothing of it is written anywhere, logged or sent.
 * - Ten minutes at most: an entry is never served past its time, and a
 *   timer (one that does not keep the instance alive) drops it then.
 * - One company's page is another's never: the key begins with the
 *   company's id, the caller's own as profiles say.
 * - Only a whole answer goes in: a failed read leaves nothing behind.
 * - A dozen pages at most: the oldest goes first; a page longer than a
 *   month's is not kept at all.
 */

import type { SearchWindow } from "./handler.ts";

/** How long a page is served from memory. */
export const PAGE_TTL_MS = 10 * 60 * 1000;
/** Pages an instance holds at once (about a dozen months of a few hundred reviews). */
export const MAX_PAGES = 12;
/**
 * The longest page kept: a month is 380–450 reviews. A longer answer means
 * the PMS ignored the window's end, and holding a dozen of those would fill
 * the instance — such a page is read and let go.
 */
export const MAX_PAGE_ITEMS = 1500;

/** Runs `drop` after `ms`; returns how to call it off. */
export type Schedule = (drop: () => void, ms: number) => () => void;

interface Entry {
  readonly items: readonly unknown[];
  readonly expiresAt: number;
  readonly cancel: () => void;
}

/**
 * A timer that lets the instance go to sleep: an idle instance is never kept
 * awake for a drop. Where the runtime has no unrefTimer the timer is plain;
 * the ten minutes hold either way (get and set never serve an older page).
 */
const unrefTimer: Schedule = (drop, ms) => {
  // Deno's timer id is a number; the bundled Node types would call it a Timeout.
  const id = setTimeout(drop, ms) as unknown as number;
  (Deno as { unrefTimer?: (id: number) => void }).unrefTimer?.(id);
  return () => clearTimeout(id);
};

/** The key of a company's window of days. */
export function pageKey(hostId: string, window: SearchWindow): string {
  return `${hostId}|${window.start}|${window.end}`;
}

export class ReviewPageCache {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #maxPages: number;
  readonly #schedule: Schedule;

  constructor(options: { ttlMs?: number; maxPages?: number; schedule?: Schedule } = {}) {
    this.#ttlMs = options.ttlMs ?? PAGE_TTL_MS;
    this.#maxPages = options.maxPages ?? MAX_PAGES;
    this.#schedule = options.schedule ?? unrefTimer;
  }

  /** How many pages are held now. */
  get size(): number {
    return this.#entries.size;
  }

  /** The page of a key while it is fresh; undefined otherwise. */
  get(key: string, now: number): readonly unknown[] | undefined {
    this.#sweep(now);
    return this.#entries.get(key)?.items;
  }

  /** Keeps a whole answer for its ten minutes; one longer than a month's is not kept. */
  set(key: string, items: readonly unknown[], now: number): void {
    this.#sweep(now);
    this.#drop(key);
    if (items.length > MAX_PAGE_ITEMS) {
      return;
    }
    while (this.#entries.size >= this.#maxPages) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#drop(oldest);
    }
    const expiresAt = now + this.#ttlMs;
    const cancel = this.#schedule(() => {
      if (this.#entries.get(key)?.expiresAt === expiresAt) {
        this.#entries.delete(key);
      }
    }, this.#ttlMs);
    this.#entries.set(key, { items, expiresAt, cancel });
  }

  #drop(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      entry.cancel();
      this.#entries.delete(key);
    }
  }

  #sweep(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#drop(key);
      }
    }
  }
}
