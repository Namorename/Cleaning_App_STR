import { isNetworkError } from '@/lib/network-error';

import { addressProblem, endpointProblem, locationAddress } from './tus-address';

/**
 * A small client of the TUS 1.0.0 protocol, as Supabase Storage speaks it at
 * `/storage/v1/upload/resumable` (docs/tech-plan.md §7.5).
 *
 * Written here rather than taken from tus-js-client (decided 2026-10-09): that
 * client holds the whole file in memory in React Native, and a video is read
 * here a piece at a time. Nothing in this file knows the app — the network,
 * the clock, the session and the file all come in from outside, so the
 * protocol can be tested against a storage that answers whatever a test
 * wants.
 *
 * The storage checks its policy on every request, and the object exists only
 * once the last byte has arrived — so the confirmation that follows works as
 * it does after a single request.
 */

/** Supabase takes the pieces at exactly this size; only the last may be shorter. */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

/**
 * The waits between the tries of one request inside one attempt of the queue.
 * Short on purpose: the queue has retries of its own and decides when there
 * is no signal; these only ride out a stairwell's blip.
 */
export const TUS_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 5_000];

/**
 * How long a piece may take before it is given up on: 6 MiB in two minutes
 * is some 420 kbit/s. Android's OkHttp under expo/fetch would otherwise wait
 * for ever on a silent socket. fetch says nothing of the bytes on their way,
 * so this is a deadline, not a watch on progress: a slower uplink is given
 * twice as long after each time its piece ran out of time without a byte
 * arriving (`stalls`), up to TUS_PATCH_STALL_MAX_MS.
 */
export const TUS_PATCH_STALL_MS = 120_000;
/** Ten minutes: some 84 kbit/s for 6 MiB. A piece slower than that is not waited on. */
export const TUS_PATCH_STALL_MAX_MS = 600_000;
/** A question or a creation carries no file: it is given up on sooner. */
export const TUS_SHORT_STALL_MS = 30_000;
const MS_PER_SECOND = 1000;

const TUS_VERSION = '1.0.0';
/** The same as supabase-js gives a single upload. */
const CACHE_CONTROL_SECONDS = '3600';
/**
 * Conflicts, expired addresses or pieces that moved nothing in a row — or
 * uploads made anew in one attempt, in a row or not — before it gives up.
 */
const MAX_DETOURS = 3;

/** The file being uploaded, read a piece at a time. */
export interface TusSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  close(): void;
}

/** Whether the app left the front since the watch began. */
export interface TusAwayWatch {
  hasLeft(): boolean;
  stop(): void;
}

/**
 * The app's place in front of her. iOS stops JavaScript in the background and
 * cuts what was on the wire: a request lost that way is not the network's
 * fault and costs no try.
 */
export interface TusPresence {
  watchAway(): TusAwayWatch;
  /** Resolves once the app is in front again; at once when it is. */
  untilInFront(): Promise<void>;
}

export interface TusRuntime {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  presence: TusPresence;
  /** Without signal the attempt hands back at once, and the queue waits for it. */
  isOnline: () => boolean;
  /** Be told when the signal goes; the request on the wire is cut then. Returns the unsubscribe. */
  onOffline: (listener: () => void) => () => void;
}

export interface TusUpload {
  endpoint: string;
  /** The project's publishable key, as every request to it carries. */
  apiKey: string;
  bucket: string;
  /** The path the server registered the file under; the policy admits no other. */
  objectName: string;
  contentType: string;
  /** The size the server registered the file with; the file must still be that size. */
  byteSize: number;
  /** Where an earlier attempt left this file, or null to start one. */
  uploadUrl: string | null;
  /** Remember a new upload's address — or forget an expired one (null). */
  saveUploadUrl: (url: string | null) => Promise<void>;
  /** The session's token now; `refresh` once the storage turned the last one down. */
  accessToken: (refresh: boolean) => Promise<string>;
  openSource: () => Promise<TusSource>;
  onProgress?: (sent: number, total: number) => void;
  /**
   * How many attempts in a row ran out of time on the piece this upload is
   * at, nothing of it arriving: each one doubles the time a piece is given
   * (`patchStallMs`). The queue keeps the count (attach-retry.ts).
   */
  stalls?: number;
}

/**
 * Why an attempt handed back without the file in, told where it was found:
 * the queue waits for signal only when nothing answered (attach-retry.ts).
 *
 * - `no-answer` — the request reached nothing, or was cut as the signal went,
 *   or the words of its answer were lost on the way;
 * - `timed-out` — a question or a creation got no answer in its time;
 * - `busy` — the storage answered it could not take it now (5xx, 408, 423, 429);
 * - `lost-place` — the storage kept losing its place: conflicts, answers
 *   without an offset, pieces taken without the offset moving;
 * - `stalled` — a piece ran out of time and the storage holds no more of it.
 */
export type TusRetryReason = 'no-answer' | 'timed-out' | 'busy' | 'lost-place' | 'stalled';

/** Worth another try: the request got no answer, or the storage could not take it now. */
export class TusRetryableError extends Error {
  readonly reason: TusRetryReason;
  /** The status the storage answered with, for `busy`. */
  readonly status: number | undefined;
  /** Where the piece that moved nothing began, for `stalled`. */
  readonly offset: number | undefined;

  constructor(
    message: string,
    reason: TusRetryReason,
    details: { status?: number; offset?: number } = {},
  ) {
    super(message);
    this.name = 'TusRetryableError';
    this.reason = reason;
    this.status = details.status;
    this.offset = details.offset;
  }
}

/** The storage refused the upload; asking again will not change its mind. */
export class TusRefusedError extends Error {
  /** The storage's status — or 0 for an endpoint refused here, before anything was sent. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TusRefusedError';
    this.status = status;
  }
}

/**
 * The file on the phone is not the one registered, or will not read whole.
 * Nothing is sent: the phone's copy is deleted once the server confirms the
 * upload, so a file that went up short would be lost for good.
 */
export class TusFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TusFileError';
  }
}

/** Where an upload stands between two requests. */
interface Position {
  /** The upload's address, or null while there is none. */
  url: string | null;
  /** How much of the file the storage holds, or null until it is asked. */
  offset: number | null;
}

/** A response as the upload reads it, a refusal's words read under the request's limit. */
interface Answer {
  status: number;
  header(name: string): string | null;
  /** A refusal's body as text; empty for a success, or when it would not arrive in time. */
  body: string;
  /** A refusal whose words did not arrive in their time: what they said is not known. */
  isCut: boolean;
}

/** A refusal's words as read: whole, or cut short — by the request's limit, the signal, a failure. */
interface Words {
  text: string;
  isWhole: boolean;
}

const ALREADY_THERE = Symbol('already there');
const GONE = Symbol('gone');
const CONFLICT = Symbol('conflict');
/** A request failed for the network and was waited out: try again. */
const RETRIED = Symbol('retried');
/** The app was put away mid-request and is in front again: carry on. */
const AWAY = Symbol('away');
/** A piece ran out of time: the storage is asked whether any of it arrived. */
const CUT_FOR_TIME = Symbol('cut for time');

/** The time a piece is given after `stalls` attempts in a row ran out of it. */
export function patchStallMs(stalls: number): number {
  return Math.min(TUS_PATCH_STALL_MS * 2 ** Math.max(0, stalls), TUS_PATCH_STALL_MAX_MS);
}

/**
 * Upload the file, resuming where `uploadUrl` left off.
 *
 * Resolves once the storage holds the whole file — or says it already had it.
 * Rejects with a `TusRetryableError` when the network would not carry it
 * after a few tries (or at once without signal), or a piece ran out of time
 * with nothing of it arriving — its `reason` says which; with a
 * `TusRefusedError` when the storage said no, and with a `TusFileError` when
 * the file is not the one registered. The file is closed either way.
 */
export async function tusUpload(upload: TusUpload, runtime: TusRuntime): Promise<void> {
  const problem = endpointProblem(upload.endpoint);
  if (problem !== null) {
    throw new TusRefusedError(0, `The resumable endpoint ${problem}`);
  }
  const source = await upload.openSource();
  try {
    if (source.size <= 0 || source.size !== upload.byteSize) {
      throw new TusFileError(
        `The file on the phone holds ${source.size} bytes; ${upload.byteSize} were registered`,
      );
    }
    await new TusSession(upload, runtime, source).run();
  } finally {
    source.close();
  }
}

class TusSession {
  private reported: number | null = null;
  /** The address kept from an earlier attempt, until it is refused once. */
  private storedUrl: string | null;
  /** The time a piece is given in this attempt. */
  private readonly patchStallMs: number;
  /** Where a piece cut for time began, until the storage says how much of it arrived. */
  private cutAt: number | null = null;

  constructor(
    private readonly upload: TusUpload,
    private readonly runtime: TusRuntime,
    private readonly source: TusSource,
  ) {
    this.storedUrl = upload.uploadUrl;
    this.patchStallMs = patchStallMs(upload.stalls ?? 0);
  }

  async run(): Promise<void> {
    let position = await this.start();
    let failures = 0;
    let detours = 0;
    // Uploads made anew in this attempt: the address gone (404, 410) or
    // refused. Unlike the other detours, progress does not start this count
    // again — an upload the storage forgets after each piece moves on every
    // time, and would have its first pieces sent for ever (item 7 of the two
    // whole-branch reviews of phone-1-2-0).
    let renewals = 0;

    for (;;) {
      if (position.offset !== null && position.offset >= this.source.size) {
        this.report(this.source.size);
        return;
      }
      const next = await this.attempt(position, failures);
      if (next === ALREADY_THERE) {
        return;
      }
      if (next === RETRIED) {
        failures += 1;
        // Part of what was sent may have arrived: the storage says where it stands.
        position = { url: position.url, offset: null };
      } else if (next === AWAY) {
        position = { url: position.url, offset: null };
      } else if (next === CUT_FOR_TIME) {
        this.cutAt = position.offset;
        position = { url: position.url, offset: null };
      } else if (this.hasMovedSinceCut(position, next)) {
        // Part of the piece cut for time arrived: the uplink is slow, not gone.
        failures = 0;
        detours = 0;
        position = next;
      } else if (hasAdvanced(position, next)) {
        // A piece went through: whatever went wrong before is behind it.
        failures = 0;
        detours = 0;
        position = next;
      } else if (isDetour(position, next)) {
        detours += 1;
        renewals += isRenewal(position, next) ? 1 : 0;
        // Outside the request's own tries: the attempt ends, for the queue to try later.
        if (detours > MAX_DETOURS || renewals > MAX_DETOURS) {
          throw new TusRetryableError(
            'Resumable upload keeps losing its place in storage',
            'lost-place',
          );
        }
        // The storage says where it stands before anything more is sent.
        position = { url: next.url, offset: null };
      } else {
        position = next;
      }
    }
  }

  /**
   * After a piece was cut for time, the storage's answer to where it stands:
   * more than when the piece began, and the upload carries on from there;
   * no more, and the attempt ends as a stall, for the queue to count and to
   * give the piece longer next time. Any other answer — a new upload, the
   * address expired — leaves nothing to compare.
   */
  private hasMovedSinceCut(before: Position, after: Position): boolean {
    const cutAt = this.cutAt;
    if (cutAt === null) {
      return false;
    }
    this.cutAt = null;
    if (after.url !== before.url || after.offset === null) {
      return false;
    }
    if (after.offset > cutAt) {
      return true;
    }
    throw new TusRetryableError(
      `Resumable upload PATCH at ${cutAt} moved nothing in ${this.patchStallMs / MS_PER_SECOND} s`,
      'stalled',
      { offset: cutAt },
    );
  }

  /**
   * One step, and what became of it: where the upload stands now, or that
   * the request failed for the network and waits before it is tried again —
   * or that the app was put away and is in front again, or that a piece ran
   * out of time and the storage is to be asked how much of it arrived.
   */
  private async attempt(
    position: Position,
    failures: number,
  ): Promise<Position | typeof ALREADY_THERE | typeof RETRIED | typeof AWAY | typeof CUT_FOR_TIME> {
    const watch = this.runtime.presence.watchAway();
    try {
      return await this.advance(position);
    } catch (error: unknown) {
      if (!(error instanceof TusRetryableError)) {
        throw error;
      }
      if (watch.hasLeft()) {
        // The system cut it, not the network: no try is spent on it.
        await this.runtime.presence.untilInFront();
        return AWAY;
      }
      if (!this.runtime.isOnline()) {
        throw error;
      }
      // A piece (the only step with both an address and an offset) out of
      // time is no blip: its own tries are not spent on it.
      if (error.reason === 'timed-out' && position.url !== null && position.offset !== null) {
        await this.runtime.sleep(TUS_RETRY_DELAYS_MS[0]);
        return CUT_FOR_TIME;
      }
      if (failures >= TUS_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await this.runtime.sleep(TUS_RETRY_DELAYS_MS[failures]);
      return RETRIED;
    } finally {
      watch.stop();
    }
  }

  /** Where to begin: the address kept from before, if it is one this upload may use. */
  private async start(): Promise<Position> {
    const kept = this.storedUrl;
    if (kept !== null && addressProblem(kept, this.upload.endpoint) !== null) {
      this.storedUrl = null;
      await this.upload.saveUploadUrl(null);
      return { url: null, offset: null };
    }
    return { url: kept, offset: null };
  }

  /** One request: the step that the position calls for. */
  private async advance(position: Position): Promise<Position | typeof ALREADY_THERE> {
    if (position.url === null) {
      const url = await this.create();
      if (url === ALREADY_THERE) {
        return ALREADY_THERE;
      }
      await this.upload.saveUploadUrl(url);
      this.report(0);
      return { url, offset: 0 };
    }
    try {
      return await this.continueAt(position.url, position.offset);
    } catch (error: unknown) {
      // An address kept from an earlier attempt may belong to an upload this
      // session may no longer touch: forgotten once, and a new one made.
      if (error instanceof TusRefusedError && position.url === this.storedUrl) {
        this.storedUrl = null;
        await this.upload.saveUploadUrl(null);
        return { url: null, offset: null };
      }
      throw error;
    }
  }

  /** A question where the upload stands, or the next piece of it. */
  private async continueAt(url: string, offset: number | null): Promise<Position> {
    const next = offset === null ? await this.head(url) : await this.patch(url, offset);
    if (next === GONE) {
      // An address lives 24 hours; after that the upload starts over.
      this.storedUrl = null;
      await this.upload.saveUploadUrl(null);
      return { url: null, offset: null };
    }
    if (next === CONFLICT) {
      return { url, offset: null };
    }
    this.report(next);
    return { url, offset: next };
  }

  private async create(): Promise<string | typeof ALREADY_THERE> {
    const answer = await this.send('POST', this.upload.endpoint, {
      'Upload-Length': String(this.source.size),
      'Upload-Metadata': this.metadata(),
    });
    const detail = isSuccess(answer.status) ? '' : detailOf(answer);
    // The object is there already — an earlier attempt finished after all.
    if (answer.status === 409 || /already exists/i.test(detail)) {
      return ALREADY_THERE;
    }
    if (!isSuccess(answer.status)) {
      throw refusal('POST', answer.status, detail);
    }
    return resolveLocation(answer.header('Location'), this.upload.endpoint, answer.status);
  }

  private async head(url: string): Promise<number | typeof GONE> {
    const answer = await this.send('HEAD', url, {});
    if (answer.status === 404 || answer.status === 410) {
      return GONE;
    }
    if (!isSuccess(answer.status)) {
      throw refusal('HEAD', answer.status, detailOf(answer));
    }
    const offset = parseOffset(answer.header('Upload-Offset'));
    if (offset === null) {
      throw new TusRetryableError('Resumable upload HEAD answered without an offset', 'lost-place');
    }
    return offset;
  }

  private async patch(
    url: string,
    offset: number,
  ): Promise<number | typeof GONE | typeof CONFLICT> {
    const length = Math.min(TUS_CHUNK_BYTES, this.source.size - offset);
    const chunk = await this.source.read(offset, length);
    if (chunk.length !== length) {
      throw new TusFileError(`The file read ${chunk.length} of ${length} bytes at ${offset}`);
    }
    const answer = await this.send(
      'PATCH',
      url,
      { 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
      chunk,
    );
    if (answer.status === 409) {
      return CONFLICT;
    }
    if (answer.status === 404 || answer.status === 410) {
      return GONE;
    }
    if (!isSuccess(answer.status)) {
      throw refusal('PATCH', answer.status, detailOf(answer));
    }
    // An answer without its offset: the storage is asked where it stands.
    return parseOffset(answer.header('Upload-Offset')) ?? CONFLICT;
  }

  /**
   * A request with a fresh token, made again once with a refreshed one when
   * the storage may have turned the token down: 401, or — as Supabase Storage
   * answers a token past its time — 400 in the JWT's own words, or a 400
   * whose words never arrived to say otherwise.
   */
  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array<ArrayBuffer>,
  ): Promise<Answer> {
    const first = await this.sendOnce(method, url, headers, body, false);
    if (!mayBeTokenRefused(first)) {
      return first;
    }
    return this.sendOnce(method, url, headers, body, true);
  }

  /**
   * One request, cut when it takes longer than its kind may — a silent socket
   * would otherwise hold the upload for ever — or when the signal goes. Cut
   * for the signal, or failed on the way, it got no answer: the queue waits
   * for signal. Cut for time, it says so, and a piece cut that way is looked
   * into before anything else is decided (`attempt`).
   *
   * The limit and the watch on the signal hold until the answer is read
   * through: a refusal's words come after its headers, and are given the
   * short limit of their own — a body that never finishes is not waited on.
   * Words lost on the way — the signal gone, the connection failed while
   * they were read — leave nothing said that can be read: no answer, not a
   * storage busy or a refusal. Words that ran out of time leave the status,
   * marked cut (`Answer.isCut`).
   */
  private async sendOnce(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array<ArrayBuffer> | undefined,
    refresh: boolean,
  ): Promise<Answer> {
    const token = await this.token(refresh);
    const controller = new AbortController();
    const stallMs = method === 'PATCH' ? this.patchStallMs : TUS_SHORT_STALL_MS;
    const wasCut: Cut = { why: null, reason: 'no-answer' };
    const cut = (why: string, reason: TusRetryReason) => {
      wasCut.why = why;
      wasCut.reason = reason;
      controller.abort();
    };
    let timer = setTimeout(
      () => cut(`timed out after ${stallMs / MS_PER_SECOND} s`, 'timed-out'),
      stallMs,
    );
    const stopListening = this.runtime.onOffline(() =>
      cut('cut: the network was lost', 'no-answer'),
    );
    try {
      let response: Response;
      try {
        response = await this.runtime.fetch(url, {
          method,
          headers: {
            ...headers,
            'Tus-Resumable': TUS_VERSION,
            Authorization: `Bearer ${token}`,
            apikey: this.upload.apiKey,
          },
          body,
          signal: controller.signal,
        });
      } catch (error: unknown) {
        // The queue reads the reason; the fetch's own words stay in the message
        // for the log, and for crash reports to tell a stairwell from a server
        // (lib/network-error.ts).
        throw new TusRetryableError(
          `Resumable upload ${method} ${wasCut.why ?? `failed: ${messageOf(error)}`}`,
          wasCut.reason,
        );
      }
      if (isSuccess(response.status)) {
        return answerOf(response, WHOLE_SILENCE);
      }
      clearTimeout(timer);
      timer = setTimeout(() => cut('body timed out', 'timed-out'), TUS_SHORT_STALL_MS);
      const words = await readBody(response, controller.signal);
      return answerOf(response, heardWords(method, response.status, words, wasCut));
    } finally {
      clearTimeout(timer);
      stopListening();
    }
  }

  private async token(refresh: boolean): Promise<string> {
    try {
      return await this.upload.accessToken(refresh);
    } catch (error: unknown) {
      if (isNetworkError(error)) {
        throw new TusRetryableError(`Session token unavailable: ${messageOf(error)}`, 'no-answer');
      }
      throw error;
    }
  }

  private metadata(): string {
    const fields: [string, string][] = [
      ['bucketName', this.upload.bucket],
      ['objectName', this.upload.objectName],
      ['contentType', this.upload.contentType],
      ['cacheControl', CACHE_CONTROL_SECONDS],
    ];
    return fields.map(([key, value]) => `${key} ${toBase64(value)}`).join(',');
  }

  private report(offset: number): void {
    if (offset === this.reported) {
      return;
    }
    this.reported = offset;
    this.upload.onProgress?.(offset, this.source.size);
  }
}

/** A piece was taken: the storage holds more than it did before this request. */
function hasAdvanced(before: Position, after: Position): boolean {
  return before.offset !== null && after.offset !== null && after.offset > before.offset;
}

/** The upload's address let go — gone, expired or refused — and a new upload to be made. */
function isRenewal(before: Position, after: Position): boolean {
  return before.url !== null && after.url === null;
}

/**
 * The upload lost its place: a piece answered with no offset, a conflict, an
 * expired address — or a piece the storage took without moving its offset.
 */
function isDetour(before: Position, after: Position): boolean {
  if (after.offset === null) {
    return true;
  }
  return before.offset !== null && after.url === before.url && after.offset <= before.offset;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The storage busy or briefly unable: 5xx, a request timeout, a locked upload, too many requests. */
function isBusy(status: number): boolean {
  return status >= 500 || status === 408 || status === 423 || status === 429;
}

function refusal(method: string, status: number, detail: string): Error {
  const message = `Resumable upload ${method} answered ${status}${detail === '' ? '' : `: ${detail}`}`;
  return isBusy(status)
    ? new TusRetryableError(message, 'busy', { status })
    : new TusRefusedError(status, message);
}

/** Why a request was cut, once it is: for the log, and for the queue (`TusRetryReason`). */
interface Cut {
  why: string | null;
  reason: TusRetryReason;
}

/**
 * A refusal's words as they were heard — or no answer at all, when they were
 * lost on the way (the signal gone, the read failed) rather than out of time.
 */
function heardWords(method: string, status: number, words: Words, cut: Cut): Words {
  if (words.isWhole || cut.reason === 'timed-out') {
    return words;
  }
  throw new TusRetryableError(
    `Resumable upload ${method} answered ${status}, its words lost: ${cut.why ?? 'the read failed'}`,
    'no-answer',
  );
}

/** A success's body is not read: nothing in it is wanted. */
const WHOLE_SILENCE: Words = { text: '', isWhole: true };
/** Words that did not arrive whole. */
const CUT_SHORT: Words = { text: '', isWhole: false };

function answerOf(response: Response, words: Words): Answer {
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    body: words.text,
    isCut: !words.isWhole,
  };
}

/**
 * The body as text — or cut short when it fails, or the moment the request
 * is cut, whichever comes first: a body that never finishes may not hear
 * the cut.
 */
function readBody(response: Response, signal: AbortSignal): Promise<Words> {
  const whenCut = new Promise<Words>((resolve) => {
    if (signal.aborted) {
      resolve(CUT_SHORT);
      return;
    }
    signal.addEventListener('abort', () => resolve(CUT_SHORT));
  });
  const read = response.text().then(
    (text): Words => ({ text, isWhole: true }),
    () => CUT_SHORT,
  );
  return Promise.race([read, whenCut]);
}

/** The storage's words for a token it will not take. */
const TOKEN_REFUSED = /jwt|exp" ?claim|exp claim/i;

/** A token turned down — or a 400 whose words, cut, cannot say it was not. */
function mayBeTokenRefused(answer: Answer): boolean {
  if (answer.status === 401) {
    return true;
  }
  return answer.status === 400 && (answer.isCut || TOKEN_REFUSED.test(answer.body));
}

/** The storage's own words about a refusal, for the log: its `message`, or the body as it came. */
function detailOf(answer: Answer): string {
  const text = answer.body;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const { message, error } = parsed as { message?: unknown; error?: unknown };
      if (typeof message === 'string') {
        return message;
      }
      if (typeof error === 'string') {
        return error;
      }
    }
  } catch {
    // Not JSON: the text is the detail.
  }
  return text.trim();
}

function parseOffset(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null;
  }
  return Number(header.trim());
}

/**
 * The upload's address: absolute as given, or a path read against the
 * endpoint's origin — and in either case where the pieces may go
 * (tus-address.ts). Anything else is refused with the status it came with,
 * and with what was wrong with it.
 */
function resolveLocation(location: string | null, endpoint: string, status: number): string {
  if (location === null || location.trim() === '') {
    throw new TusRefusedError(
      status,
      `Resumable upload POST answered ${status} without a Location`,
    );
  }
  const url = locationAddress(location.trim(), endpoint);
  const problem = addressProblem(url, endpoint);
  if (problem !== null) {
    throw new TusRefusedError(
      status,
      `Resumable upload POST answered ${status} with a Location ${problem}`,
    );
  }
  return url;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8, then base64 — the protocol's encoding of metadata values. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const second = left > 1 ? bytes[i + 1] : 0;
    const third = left > 2 ? bytes[i + 2] : 0;
    const triple = (bytes[i] << 16) | (second << 8) | third;
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63];
    out += left > 1 ? BASE64[(triple >> 6) & 63] : '=';
    out += left > 2 ? BASE64[triple & 63] : '=';
  }
  return out;
}
