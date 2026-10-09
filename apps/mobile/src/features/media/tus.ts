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

const TUS_VERSION = '1.0.0';
/** The same as supabase-js gives a single upload. */
const CACHE_CONTROL_SECONDS = '3600';
/** Conflicts or expired addresses in a row before the attempt gives up on them. */
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
}

export interface TusUpload {
  endpoint: string;
  /** The project's publishable key, as every request to it carries. */
  apiKey: string;
  bucket: string;
  /** The path the server registered the file under; the policy admits no other. */
  objectName: string;
  contentType: string;
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

/** Where an upload stands between two requests. */
interface Position {
  /** The upload's address, or null while there is none. */
  url: string | null;
  /** How much of the file the storage holds, or null until it is asked. */
  offset: number | null;
}

const ALREADY_THERE = Symbol('already there');
const GONE = Symbol('gone');
const CONFLICT = Symbol('conflict');

/**
 * Upload the file, resuming where `uploadUrl` left off.
 *
 * Resolves once the storage holds the whole file — or says it already had it.
 * Rejects with a `TusRetryableError` when the network would not carry it
 * after a few tries (or at once without signal), and with a `TusRefusedError`
 * when the storage said no. The file is closed either way.
 */
export async function tusUpload(upload: TusUpload, runtime: TusRuntime): Promise<void> {
  const source = await upload.openSource();
  try {
    await new TusSession(upload, runtime, source).run();
  } finally {
    source.close();
  }
}

class TusSession {
  private reported: number | null = null;

  constructor(
    private readonly upload: TusUpload,
    private readonly runtime: TusRuntime,
    private readonly source: TusSource,
  ) {}

  async run(): Promise<void> {
    let position: Position = { url: this.upload.uploadUrl, offset: null };
    let failures = 0;
    let detours = 0;

    for (;;) {
      if (position.offset !== null && position.offset >= this.source.size) {
        this.report(this.source.size);
        return;
      }
      const watch = this.runtime.presence.watchAway();
      try {
        const next = await this.advance(position);
        if (next === ALREADY_THERE) {
          return;
        }
        if (hasAdvanced(position, next)) {
          // A piece went through: whatever went wrong before is behind it.
          failures = 0;
          detours = 0;
        } else if (next.offset === null) {
          detours += 1;
          if (detours > MAX_DETOURS) {
            throw new TusRetryableError('Resumable upload keeps losing its place in storage');
          }
        }
        position = next;
      } catch (error: unknown) {
        if (!(error instanceof TusRetryableError)) {
          throw error;
        }
        if (watch.hasLeft()) {
          // The system cut it, not the network: no try is spent on it.
          await this.runtime.presence.untilInFront();
        } else if (!this.runtime.isOnline() || failures >= TUS_RETRY_DELAYS_MS.length) {
          throw error;
        } else {
          await this.runtime.sleep(TUS_RETRY_DELAYS_MS[failures]);
          failures += 1;
        }
        // Part of what was sent may have arrived: the storage says where it stands.
        position = { url: position.url, offset: null };
      } finally {
        watch.stop();
      }
    }
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
    if (position.offset === null) {
      const offset = await this.head(position.url);
      if (offset === GONE) {
        // An address lives 24 hours; after that the upload starts over.
        await this.upload.saveUploadUrl(null);
        return { url: null, offset: null };
      }
      this.report(offset);
      return { url: position.url, offset };
    }
    const offset = await this.patch(position.url, position.offset);
    if (offset === GONE) {
      await this.upload.saveUploadUrl(null);
      return { url: null, offset: null };
    }
    if (offset === CONFLICT) {
      return { url: position.url, offset: null };
    }
    this.report(offset);
    return { url: position.url, offset };
  }

  private async create(): Promise<string | typeof ALREADY_THERE> {
    const response = await this.send('POST', this.upload.endpoint, {
      'Upload-Length': String(this.source.size),
      'Upload-Metadata': this.metadata(),
    });
    const detail = isSuccess(response.status) ? '' : await detailOf(response);
    // The object is there already — an earlier attempt finished after all.
    if (response.status === 409 || /already exists/i.test(detail)) {
      return ALREADY_THERE;
    }
    if (!isSuccess(response.status)) {
      throw refusal('POST', response.status, detail);
    }
    return resolveLocation(response.headers.get('Location'), this.upload.endpoint);
  }

  private async head(url: string): Promise<number | typeof GONE> {
    const response = await this.send('HEAD', url, {});
    if (response.status === 404 || response.status === 410) {
      return GONE;
    }
    if (!isSuccess(response.status)) {
      throw refusal('HEAD', response.status, await detailOf(response));
    }
    const offset = parseOffset(response.headers.get('Upload-Offset'));
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
    const response = await this.send(
      'PATCH',
      url,
      { 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
      chunk,
    );
    if (response.status === 409) {
      return CONFLICT;
    }
    if (response.status === 404 || response.status === 410) {
      return GONE;
    }
    if (!isSuccess(response.status)) {
      throw refusal('PATCH', response.status, await detailOf(response));
    }
    // An answer without its offset: the storage is asked where it stands.
    return parseOffset(response.headers.get('Upload-Offset')) ?? CONFLICT;
  }

  /** A request with a fresh token, made again once with a refreshed one on 401. */
  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    const response = await this.sendOnce(method, url, headers, body, false);
    if (response.status !== 401) {
      return response;
    }
    return this.sendOnce(method, url, headers, body, true);
  }

  private async sendOnce(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array<ArrayBuffer> | undefined,
    refresh: boolean,
  ): Promise<Response> {
    const token = await this.token(refresh);
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
      });
    } catch (error: unknown) {
      // Kept in the message: "Network request failed" is how the app tells
      // a stairwell from a server (lib/network-error.ts).
      throw new TusRetryableError(`Resumable upload ${method} failed: ${messageOf(error)}`);
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

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The storage busy or briefly unable: 5xx, a locked upload, too many requests. */
function isBusy(status: number): boolean {
  return status >= 500 || status === 423 || status === 429;
}

function refusal(method: string, status: number, detail: string): Error {
  const message = `Resumable upload ${method} answered ${status}${detail === '' ? '' : `: ${detail}`}`;
  return isBusy(status) ? new TusRetryableError(message) : new TusRefusedError(status, message);
}

/** The storage's own words about a refusal, for the log: its `message`, or the body as it came. */
async function detailOf(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return '';
  }
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

/** The upload's address: absolute as given, or a path read against the endpoint's origin. */
function resolveLocation(location: string | null, endpoint: string): string {
  if (location !== null && /^https?:\/\//i.test(location)) {
    return location;
  }
  const origin = /^https?:\/\/[^/]+/i.exec(endpoint)?.[0];
  if (location !== null && location.startsWith('/') && origin !== undefined) {
    return `${origin}${location}`;
  }
  throw new TusRefusedError(201, `Resumable upload POST answered without a usable Location`);
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
