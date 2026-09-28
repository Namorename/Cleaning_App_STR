/**
 * What a camera writes into a photo about where, when and on what it was
 * taken — GPS, capture time, make and model, comments, a second picture
 * after the first — taken out before the photo leaves the device (owner's
 * word, 2026-09-28).
 *
 * The file is walked, not decoded: segments the picture needs are copied
 * byte for byte, everything else is left behind. Nothing is re-encoded, so
 * the picture loses no quality, and the same input always gives the same
 * bytes — an upload retried after a lost connection sends exactly the size
 * its row declared.
 *
 * What is kept is an allow-list, so a kind of metadata nobody has thought of
 * yet is dropped rather than carried:
 * - JPEG: the image segments (tables, frame, scans, restart interval), JFIF,
 *   the colour profile (APP2 ICC_PROFILE) and Adobe's colour transform
 *   (APP14). The one fact of the Exif block a viewer needs — which way up the
 *   picture goes — is written back alone, in a block of its own.
 * - WebP: every chunk but EXIF and XMP; the header's flags stop announcing
 *   them.
 *
 * What a browser still shows, the walk takes, the way libjpeg reads it: a
 * picture cut off inside or after its scan is closed with the end marker it
 * lacks, and stray bytes between segments are stepped over. Refusing such a
 * file would fail a photo after its message was sent, on every retry. The
 * skipped bytes are dropped, so none of this carries metadata along. A file
 * cut off among its segments, before any picture, is refused.
 *
 * Uint8Array only: the phone runs this in Hermes, which has no Node Buffer.
 */

/** A file that cannot be walked: not the format it says, or cut short. */
export class ImageMetadataError extends Error {
  override readonly name = 'ImageMetadataError';
}

const MARKER = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;
const RST0 = 0xd0;
const RST7 = 0xd7;
const TEM = 0x01;
const ORIENTATION_TAG = 0x0112;
const SHORT = 3;
const UPRIGHT = 1;

/** The APP segments a picture needs, known by the signature they open with. */
const KEPT_APP_SEGMENTS: ReadonlyMap<number, string> = new Map([
  [APP0, 'JFIF\0'],
  [APP2, 'ICC_PROFILE\0'],
  [APP14, 'Adobe'],
]);

function startsWith(bytes: Uint8Array, at: number, end: number, text: string): boolean {
  if (at + text.length > end) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[at + i] !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function readU16(bytes: Uint8Array, at: number, littleEndian = false): number {
  return littleEndian ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
}

function readU32(bytes: Uint8Array, at: number, littleEndian = false): number {
  return littleEndian
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Which way up the picture goes (1..8), from an Exif APP1 payload between
 * `start` and `end`, or null when it does not say. A malformed block is read
 * as silent, never as an error: it is dropped either way.
 */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (!startsWith(bytes, start, end, 'Exif\0\0')) {
    return null;
  }
  const tiff = start + 6;
  if (tiff + 8 > end) {
    return null;
  }
  const littleEndian = startsWith(bytes, tiff, end, 'II');
  if (!littleEndian && !startsWith(bytes, tiff, end, 'MM')) {
    return null;
  }
  const ifd = tiff + readU32(bytes, tiff + 4, littleEndian);
  if (ifd + 2 > end) {
    return null;
  }
  const entries = readU16(bytes, ifd, littleEndian);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) {
      return null;
    }
    if (readU16(bytes, entry, littleEndian) === ORIENTATION_TAG) {
      const value =
        readU16(bytes, entry + 2, littleEndian) === SHORT
          ? readU16(bytes, entry + 8, littleEndian)
          : null;
      return value !== null && value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** An Exif APP1 holding the orientation and nothing else: big-endian, one IFD, one entry. */
function orientationSegment(orientation: number): Uint8Array {
  const payload = Uint8Array.of(
    ...[0x45, 0x78, 0x69, 0x66, 0, 0], // "Exif\0\0"
    ...[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8], // "MM", 42, IFD0 at 8
    ...[0, 1], // one entry
    ...[0x01, 0x12, 0, SHORT, 0, 0, 0, 1, 0, orientation, 0, 0], // Orientation
    ...[0, 0, 0, 0], // no next IFD
  );
  return concat([Uint8Array.of(MARKER, APP1, 0, payload.length + 2), payload]);
}

/**
 * Where the entropy-coded data of a scan starting at `from` ends: at the next
 * real marker, or where the file ends when it was cut off inside the scan
 * (a lone FF at the very end is left out).
 */
function scanEnd(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at < bytes.length) {
    if (bytes[at] !== MARKER) {
      at += 1;
      continue;
    }
    const next = bytes[at + 1];
    if (next === undefined) {
      return at;
    }
    // A stuffed zero and a restart marker belong to the data; a fill byte
    // before a marker is skipped over.
    if (next === 0x00 || (next >= RST0 && next <= RST7)) {
      at += 2;
    } else if (next === MARKER) {
      at += 1;
    } else {
      return at;
    }
  }
  return bytes.length;
}

/** The next byte from `from` that starts a marker; stray bytes before it are left out. */
function nextMarker(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at + 1 < bytes.length) {
    if (bytes[at] === MARKER && bytes[at + 1] !== 0x00 && bytes[at + 1] !== MARKER) {
      return at;
    }
    at += 1;
  }
  return bytes.length;
}

function keepsSegment(bytes: Uint8Array, marker: number, start: number, end: number): boolean {
  if (marker === COM) {
    return false;
  }
  if (marker >= APP0 && marker <= APP15) {
    const signature = KEPT_APP_SEGMENTS.get(marker);
    return signature !== undefined && startsWith(bytes, start, end, signature);
  }
  return true;
}

/**
 * The JPEG with its metadata taken out, or the same array when there was
 * nothing to take.
 *
 * @throws ImageMetadataError when the bytes are not a whole JPEG.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== MARKER || bytes[1] !== SOI) {
    throw new ImageMetadataError('Not a JPEG: no start-of-image marker');
  }

  const kept: Uint8Array[] = [];
  let orientation: number | null = null;
  let seenExif = false;
  let seenScan = false;
  let at = 2;

  for (;;) {
    while (bytes[at] === MARKER && bytes[at + 1] === MARKER) {
      at += 1;
    }
    if (at < bytes.length && (bytes[at] !== MARKER || at + 1 >= bytes.length)) {
      at = nextMarker(bytes, at);
    }
    if (at >= bytes.length) {
      if (!seenScan) {
        throw new ImageMetadataError('The JPEG ends before its picture begins');
      }
      // Cut off after the picture began: closed the way a viewer closes it.
      kept.push(Uint8Array.of(MARKER, EOI));
      break;
    }
    const marker = bytes[at + 1];
    if (marker === EOI) {
      // Whatever follows — a phone's second picture, a trailer — is not kept.
      kept.push(bytes.subarray(at, at + 2));
      break;
    }
    if (marker === TEM || (marker >= RST0 && marker <= RST7)) {
      kept.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = at + 4 <= bytes.length ? readU16(bytes, at + 2) : -1;
    if (length >= 0 && length < 2) {
      // An empty segment: nothing to keep, and nothing to read past.
      at += 4;
      continue;
    }
    const end = at + 2 + length;
    if (length < 0 || end > bytes.length) {
      if (!seenScan) {
        throw new ImageMetadataError('The JPEG ends inside a segment');
      }
      // A segment cut off after the picture: the picture ends here.
      kept.push(Uint8Array.of(MARKER, EOI));
      break;
    }
    // Viewers turn the picture by the first Exif block before the picture;
    // a later one, or one after it, turns nothing.
    if (marker === APP1 && !seenExif && !seenScan && startsWith(bytes, at + 4, end, 'Exif\0\0')) {
      seenExif = true;
      orientation = exifOrientation(bytes, at + 4, end);
    }
    if (keepsSegment(bytes, marker, at + 4, end)) {
      kept.push(bytes.subarray(at, end));
    }
    at = end;
    if (marker === SOS) {
      seenScan = true;
      const dataEnd = scanEnd(bytes, at);
      kept.push(bytes.subarray(at, dataEnd));
      at = dataEnd;
    }
  }

  // The orientation goes right after JFIF when there is one, else after SOI.
  const first = kept[0];
  const afterJfif = first !== undefined && first[1] === APP0 ? 1 : 0;
  const turned =
    orientation !== null && orientation !== UPRIGHT ? [orientationSegment(orientation)] : [];
  const stripped = concat([
    bytes.subarray(0, 2),
    ...kept.slice(0, afterJfif),
    ...turned,
    ...kept.slice(afterJfif),
  ]);
  return sameBytes(stripped, bytes) ? bytes : stripped;
}

const RIFF_HEADER = 12;
const CHUNK_HEADER = 8;
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;
const DROPPED_CHUNKS: ReadonlySet<string> = new Set(['EXIF', 'XMP ']);

function chunkId(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * The WebP with its EXIF and XMP chunks taken out, or the same array when
 * there were none.
 *
 * @throws ImageMetadataError when the bytes are not a whole WebP.
 */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < RIFF_HEADER ||
    !startsWith(bytes, 0, bytes.length, 'RIFF') ||
    !startsWith(bytes, 8, bytes.length, 'WEBP')
  ) {
    throw new ImageMetadataError('Not a WebP: no RIFF/WEBP header');
  }
  const end = 8 + readU32(bytes, 4, true);
  if (end > bytes.length) {
    throw new ImageMetadataError('The WebP is shorter than its header says');
  }

  const kept: Uint8Array[] = [];
  let dropped = end < bytes.length;
  let at = RIFF_HEADER;
  while (at < end) {
    if (at + CHUNK_HEADER > end) {
      throw new ImageMetadataError('The WebP ends inside a chunk header');
    }
    const id = chunkId(bytes, at);
    const size = readU32(bytes, at + 4, true);
    if (at + CHUNK_HEADER + size > end) {
      throw new ImageMetadataError('The WebP ends inside a chunk');
    }
    // Chunks are padded to an even length; a last chunk may lack its pad.
    const chunkEnd = Math.min(at + CHUNK_HEADER + size + (size % 2), end);
    if (DROPPED_CHUNKS.has(id)) {
      dropped = true;
    } else if (id === 'VP8X') {
      const header = bytes.slice(at, chunkEnd);
      header[CHUNK_HEADER] &= ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP);
      if (header[CHUNK_HEADER] !== bytes[at + CHUNK_HEADER]) {
        dropped = true;
      }
      kept.push(header);
    } else {
      kept.push(bytes.subarray(at, chunkEnd));
    }
    at = chunkEnd;
  }

  if (!dropped) {
    return bytes;
  }
  const body = concat(kept);
  const size = 4 + body.length;
  return concat([
    Uint8Array.of(0x52, 0x49, 0x46, 0x46), // "RIFF"
    Uint8Array.of(size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff),
    Uint8Array.of(0x57, 0x45, 0x42, 0x50), // "WEBP"
    body,
  ]);
}

/**
 * The photo without its metadata, for the kinds of photo the bucket takes
 * (JPEG and WebP). Anything else comes back untouched: it is not a photo this
 * app uploads, and guessing at its format would be worse than leaving it.
 *
 * @throws ImageMetadataError when a JPEG or WebP cannot be walked.
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  // Read the way the composer and the server read it: lowercased.
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return stripJpegMetadata(bytes);
    case 'image/webp':
      return stripWebpMetadata(bytes);
    default:
      return bytes;
  }
}
