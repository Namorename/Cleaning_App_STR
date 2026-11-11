/**
 * The last answers of one instance of guest-message-text, so that opening the same task twice in a
 * moment asks Hostaway once (docs/guest-message-text.md).
 *
 * - Memory only: nothing of it is written anywhere, logged or sent.
 * - Three minutes at most: an answer is never served past its time, and a timer (one that does not
 *   keep the instance alive) drops it then.
 * - One company's answer is another's never: the key begins with the company's id, the caller's own
 *   as profiles say; the reader's rights are checked before every read of it.
 * - A few dozen answers at most, of three messages each: the oldest goes first.
 */

import type { GuestMessage } from "./handler.ts";

/** How long an answer is served from memory. */
export const ANSWER_TTL_MS = 3 * 60 * 1000;
/** Answers an instance holds at once. */
export const MAX_ANSWERS = 30;

/** Runs `drop` after `ms`; returns how to call it off. */
export type Schedule = (drop: () => void, ms: number) => () => void;

interface Entry {
  readonly messages: readonly GuestMessage[];
  readonly expiresAt: number;
  readonly cancel: () => void;
}

/** A timer that lets the instance go to sleep; where the runtime has no unrefTimer it is plain. */
const unrefTimer: Schedule = (drop, ms) => {
  // Deno's timer id is a number; the bundled Node types would call it a Timeout.
  const id = setTimeout(drop, ms) as unknown as number;
  (Deno as { unrefTimer?: (id: number) => void }).unrefTimer?.(id);
  return () => clearTimeout(id);
};

/** The key of one message of one company's conversation. */
export function answerKey(hostId: string, conversationId: string, message: string): string {
  return `${hostId}|${conversationId}|${message}`;
}

export class MessageAnswerCache {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #schedule: Schedule;

  constructor(options: { ttlMs?: number; max?: number; schedule?: Schedule } = {}) {
    this.#ttlMs = options.ttlMs ?? ANSWER_TTL_MS;
    this.#max = options.max ?? MAX_ANSWERS;
    this.#schedule = options.schedule ?? unrefTimer;
  }

  /** How many answers are held now. */
  get size(): number {
    return this.#entries.size;
  }

  /** The answer of a key while it is fresh; undefined otherwise. */
  get(key: string, now: number): readonly GuestMessage[] | undefined {
    this.#sweep(now);
    return this.#entries.get(key)?.messages;
  }

  /** Keeps an answer for its three minutes. */
  set(key: string, messages: readonly GuestMessage[], now: number): void {
    this.#sweep(now);
    this.#drop(key);
    while (this.#entries.size >= this.#max) {
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
    this.#entries.set(key, { messages, expiresAt, cancel });
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
