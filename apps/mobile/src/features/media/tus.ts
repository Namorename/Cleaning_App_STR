import { isNetworkError } from '@/lib/network-error';

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
 * is some 50 KiB/s, slower than any network worth waiting on. Android's
 * OkHttp under expo/fetch would otherwise wait for ever on a silent socket.
 */
export const TUS_PATCH_STALL_MS = 120_000;
/** A question or a creation carries no file: it is given up on sooner. */
export const TUS_SHORT_STALL_MS = 30_000;
const MS_PER_SECOND = 1000;

const TUS_VERSION = '1.0.0';
/** The same as supabase-js gives a single upload. */
const CACHE_CONTROL_SECONDS = '3600';
/** Conflicts, expired addresses or pieces that moved nothing in a row before the attempt gives up. */
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
}

/** Worth another try: the request got no answer, or the storage could not take it now. */
export class TusRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TusRetryableError';
  }
}

/** The storage refused the upload; asking again will not change its mind. */
export class TusRefusedError extends Error {
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

/** A response, its body read at most once. */
interface Answer {
  status: number;
  header(name: string): string | null;
  /** The body as text; empty when it cannot be read. */
  text(): Promise<string>;
}

const ALREADY_THERE = Symbol('already there');
const GONE = Symbol('gone');
const CONFLICT = Symbol('conflict');
/** A request failed for the network and was waited out: try again. */
const RETRIED = Symbol('retried');
/** The app was put away mid-request and is in front again: carry on. */
const AWAY = Symbol('away');

/**
 * Upload the file, resuming where `uploadUrl` left off.
 *
 * Resolves once the storage holds the whole file — or says it already had it.
 * Rejects with a `TusRetryableError` when the network would not carry it
 * after a few tries (or at once without signal), with a `TusRefusedError`
 * when the storage said no, and with a `TusFileError` when the file is not
 * the one registered. The file is closed either way.
 */
export async function tusUpload(upload: TusUpload, runtime: TusRuntime): Promise<void> {
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

  constructor(
    private readonly upload: TusUpload,
    private readonly runtime: TusRuntime,
    private readonly source: TusSource,
  ) {
    this.storedUrl = upload.uploadUrl;
  }

  async run(): Promise<void> {
    let position = await this.start();
    let failures = 0;
    let detours = 0;

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
      } else if (hasAdvanced(position, next)) {
        // A piece went through: whatever went wrong before is behind it.
        failures = 0;
        detours = 0;
        position = next;
      } else if (isDetour(position, next)) {
        detours += 1;
        // Outside the request's own tries: the attempt ends, for the queue to try later.
        if (detours > MAX_DETOURS) {
          throw new TusRetryableError('Resumable upload keeps losing its place in storage');
        }
        // The storage says where it stands before anything more is sent.
        position = { url: next.url, offset: null };
      } else {
        position = next;
      }
    }
  }

  /**
   * One step, and what became of it: where the upload stands now, or that
   * the request failed for the network and waits before it is tried again —
   * or that the app was put away and is in front again.
   */
  private async attempt(
    position: Position,
    failures: number,
  ): Promise<Position | typeof ALREADY_THERE | typeof RETRIED | typeof AWAY> {
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
      if (!this.runtime.isOnline() || failures >= TUS_RETRY_DELAYS_MS.length) {
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
    if (kept !== null && !isOwnAddress(kept, this.upload.endpoint)) {
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
    const detail = isSuccess(answer.status) ? '' : await detailOf(answer);
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
      throw refusal('HEAD', answer.status, await detailOf(answer));
    }
    const offset = parseOffset(answer.header('Upload-Offset'));
    if (offset === null) {
      throw new TusRetryableError('Resumable upload HEAD answered without an offset');
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
      throw refusal('PATCH', answer.status, await detailOf(answer));
    }
    // An answer without its offset: the storage is asked where it stands.
    return parseOffset(answer.header('Upload-Offset')) ?? CONFLICT;
  }

  /**
   * A request with a fresh token, made again once with a refreshed one when
   * the storage turned the token down: 401, or — as Supabase Storage answers
   * a token past its time — 400 in the JWT's own words.
   */
  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array<ArrayBuffer>,
  ): Promise<Answer> {
    const first = answerOf(await this.sendOnce(method, url, headers, body, false));
    if (!(await isTokenRefused(first))) {
      return first;
    }
    return answerOf(await this.sendOnce(method, url, headers, body, true));
  }

  /**
   * One request, cut when it takes longer than its kind may — a silent socket
   * would otherwise hold the upload for ever — or when the signal goes. Cut
   * either way, it is the network's failure: the storage is asked where it
   * stands, and the queue waits for signal.
   */
  private async sendOnce(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array<ArrayBuffer> | undefined,
    refresh: boolean,
  ): Promise<Response> {
    const token = await this.token(refresh);
    const controller = new AbortController();
    const stallMs = method === 'PATCH' ? TUS_PATCH_STALL_MS : TUS_SHORT_STALL_MS;
    let cutBecause: string | null = null;
    const cut = (why: string) => {
      cutBecause = why;
      controller.abort();
    };
    const timer = setTimeout(() => cut(`timed out after ${stallMs / MS_PER_SECOND} s`), stallMs);
    const stopListening = this.runtime.onOffline(() => cut('cut: the network was lost'));
    try {
      return await this.runtime.fetch(url, {
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
      // Kept in the message: "Network request failed" and "timed out" are how
      // the app tells a stairwell from a server (lib/network-error.ts).
      throw new TusRetryableError(
        `Resumable upload ${method} ${cutBecause ?? `failed: ${messageOf(error)}`}`,
      );
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
        throw new TusRetryableError(`Session token unavailable: ${messageOf(error)}`);
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
  return isBusy(status) ? new TusRetryableError(message) : new TusRefusedError(status, message);
}

function answerOf(response: Response): Answer {
  let text: Promise<string> | null = null;
  return {
    status: response.status,
    header: (name) => response.headers.get(name),
    text: () => {
      text ??= response.text().catch(() => '');
      return text;
    },
  };
}

/** The storage's words for a token it will not take. */
const TOKEN_REFUSED = /jwt|exp" ?claim|exp claim/i;

async function isTokenRefused(answer: Answer): Promise<boolean> {
  if (answer.status === 401) {
    return true;
  }
  return answer.status === 400 && TOKEN_REFUSED.test(await answer.text());
}

/** The storage's own words about a refusal, for the log: its `message`, or the body as it came. */
async function detailOf(answer: Answer): Promise<string> {
  const text = await answer.text();
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

/** The scheme and host of an https address, or null for anything else. */
function httpsOrigin(url: string): string | null {
  return /^https:\/\/[^/?#]+/i.exec(url)?.[0].toLowerCase() ?? null;
}

/** An address on the endpoint's own host, over TLS: the only place a piece may go. */
function isOwnAddress(url: string, endpoint: string): boolean {
  const origin = httpsOrigin(endpoint);
  return origin !== null && httpsOrigin(url) === origin;
}

/**
 * The upload's address: absolute as given, or a path read against the
 * endpoint's origin — and in either case on the endpoint's own host, over
 * TLS. Anything else is refused with the status it came with.
 */
function resolveLocation(location: string | null, endpoint: string, status: number): string {
  const origin = httpsOrigin(endpoint);
  if (location !== null && origin !== null) {
    const url = location.startsWith('/') ? `${origin}${location}` : location;
    if (isOwnAddress(url, endpoint)) {
      return url;
    }
  }
  throw new TusRefusedError(
    status,
    `Resumable upload POST answered ${status} without a Location on its own host`,
  );
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
