import { describe, expect, test } from 'vitest';

import { ImageMetadataError, stripImageMetadata } from '@str-ops/shared';

import {
  BASELINE_JPEG_BASE64,
  PROGRESSIVE_JPEG_BASE64,
  WEBP_BASE64,
  ascii,
  concat,
  dirtyJpeg,
  dirtyWebp,
  exifApp1,
  fromBase64,
  iccApp2,
  jfifApp0,
  metadataLeaks,
  restartJpeg,
  scanData,
  segment,
} from '../../../../../packages/shared/src/testing/image-fixtures';

/**
 * What a camera writes into a photo — where it was taken, when, on which
 * phone — does not leave the device with it (owner's word, 2026-09-28). The
 * panel sends a manager's file as it is on her disk, so the panel strips it;
 * the phone re-encodes every photo and strips it again as a guard.
 *
 * Stripping works on the bytes, not the pixels: nothing is decoded or
 * re-encoded, the picture is the same file minus its metadata, and the same
 * input always gives the same output — a retried upload sends the size it
 * registered.
 */

const baseline = fromBase64(BASELINE_JPEG_BASE64);
const progressive = fromBase64(PROGRESSIVE_JPEG_BASE64);

/** The Exif block a stripped photo keeps when it has to be turned: orientation, nothing else. */
function orientationOnly(orientation: number): Uint8Array {
  const tiff = concat(
    ascii('MM\0*'),
    Uint8Array.of(0, 0, 0, 8), // IFD0 right after the header
    Uint8Array.of(0, 1), // one entry
    Uint8Array.of(0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0), // Orientation, SHORT, 1
    Uint8Array.of(0, 0, 0, 0), // no next IFD
  );
  return segment(0xe1, concat(ascii('Exif\0\0'), tiff));
}

/** The whole length of an Exif APP1 segment the fixtures build. */
function exifLength(orientation: number): number {
  return exifApp1(orientation).length;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

describe('a JPEG', () => {
  test.each([
    ['baseline', baseline],
    ['progressive', progressive],
  ])('%s: place, time, phone and comments are gone; the image is untouched', (_name, clean) => {
    // Arrange
    const dirty = dirtyJpeg(clean);
    expect(metadataLeaks(dirty).length).toBeGreaterThan(0);

    // Act
    const stripped = stripImageMetadata(dirty, 'image/jpeg');

    // Assert
    expect(metadataLeaks(stripped)).toEqual([]);
    expect(scanData(stripped)).toEqual(scanData(clean));
    expect(stripped.subarray(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8));
    expect(stripped.subarray(-2)).toEqual(Uint8Array.of(0xff, 0xd9));
  });

  test('a photo taken sideways stays the right way up: its orientation is kept alone', () => {
    const stripped = stripImageMetadata(dirtyJpeg(baseline, 6), 'image/jpeg');

    expect(contains(stripped, orientationOnly(6))).toBe(true);
  });

  test('an upright photo keeps no Exif block at all', () => {
    const stripped = stripImageMetadata(dirtyJpeg(baseline, 1), 'image/jpeg');

    expect(contains(stripped, ascii('Exif\0\0'))).toBe(false);
  });

  test('what the picture needs to be shown right is kept: JFIF and the colour profile', () => {
    const stripped = stripImageMetadata(dirtyJpeg(baseline), 'image/jpeg');

    expect(contains(stripped, jfifApp0())).toBe(true);
    expect(contains(stripped, iccApp2())).toBe(true);
  });

  test('a second image stored after the first is not carried along', () => {
    const dirty = dirtyJpeg(baseline);

    const stripped = stripImageMetadata(dirty, 'image/jpeg');

    // Everything after the first EOI was the phone's extra picture.
    expect(stripped.length).toBeLessThan(dirty.length - baseline.length);
    expect(stripped.subarray(-2)).toEqual(Uint8Array.of(0xff, 0xd9));
  });

  test('a scan with restart markers and stuffed bytes is carried byte for byte', () => {
    const withRestarts = restartJpeg();

    const stripped = stripImageMetadata(withRestarts, 'image/jpeg');

    expect(scanData(stripped)).toEqual(scanData(withRestarts));
    expect(contains(stripped, Uint8Array.of(0xff, 0xdd, 0, 4, 0, 1))).toBe(true);
    expect(metadataLeaks(stripped)).toEqual([]);
  });

  test('a photo with nothing to remove comes back as the very same bytes', () => {
    expect(stripImageMetadata(baseline, 'image/jpeg')).toBe(baseline);
  });

  test('stripping twice changes nothing the second time', () => {
    const once = stripImageMetadata(dirtyJpeg(baseline), 'image/jpeg');

    expect(stripImageMetadata(once, 'image/jpeg')).toBe(once);
  });

  test('the same file always gives the same bytes, so a retry sends what was registered', () => {
    const dirty = dirtyJpeg(progressive);

    expect(stripImageMetadata(dirty, 'image/jpeg')).toEqual(
      stripImageMetadata(dirty, 'image/jpeg'),
    );
  });

  test('a file cut short among its metadata is refused, not half-cleaned', () => {
    const dirty = dirtyJpeg(baseline);
    const cut = dirty.subarray(0, Math.floor(dirty.length / 3));

    expect(() => stripImageMetadata(cut, 'image/jpeg')).toThrow(ImageMetadataError);
  });

  // What a browser still shows, the walk takes too — the way libjpeg reads it
  // ("premature end", "extraneous bytes before marker"). Refusing it would
  // fail the photo after its message is already sent, on every retry.
  test('a picture cut off inside its scan is cleaned and closed, as a browser shows it', () => {
    const dirty = dirtyJpeg(baseline);
    const firstEnd = dirty.length - (baseline.length + exifLength(1)) + 2;
    const noEnd = dirty.subarray(0, firstEnd - 2 - 7);

    const stripped = stripImageMetadata(noEnd, 'image/jpeg');

    expect(metadataLeaks(stripped)).toEqual([]);
    expect(stripped.subarray(-2)).toEqual(Uint8Array.of(0xff, 0xd9));
    expect(contains(stripped, scanData(baseline).subarray(0, 20))).toBe(true);
  });

  test('stray bytes between segments are stepped over, not read as a broken file', () => {
    const body = baseline.subarray(2);
    const withStray = concat(
      Uint8Array.of(0xff, 0xd8),
      exifApp1(6),
      Uint8Array.of(0x00, 0x12, 0x34),
      body,
    );

    const stripped = stripImageMetadata(withStray, 'image/jpeg');

    expect(metadataLeaks(stripped)).toEqual([]);
    expect(scanData(stripped)).toEqual(scanData(baseline));
  });

  test('an empty segment is stepped over', () => {
    const withEmpty = concat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe3, 0, 0), baseline.subarray(2));

    expect(scanData(stripImageMetadata(withEmpty, 'image/jpeg'))).toEqual(scanData(baseline));
  });

  test('little-endian Exif, as many Android phones write it, keeps its orientation', () => {
    const tiff = concat(
      ascii('II*\0'),
      Uint8Array.of(8, 0, 0, 0),
      Uint8Array.of(1, 0),
      Uint8Array.of(0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0),
      Uint8Array.of(0, 0, 0, 0),
    );
    const photo = concat(
      Uint8Array.of(0xff, 0xd8),
      segment(0xe1, concat(ascii('Exif\0\0'), tiff)),
      baseline.subarray(2),
    );

    expect(contains(stripImageMetadata(photo, 'image/jpeg'), orientationOnly(8))).toBe(true);
  });

  test('the orientation is the first Exif block’s, as viewers read it', () => {
    // The first block says nothing of orientation, so the picture is upright;
    // a later block's 6 is not what anyone showed.
    const upright = exifApp1(6).slice();
    const noOrientation = concat(
      Uint8Array.of(0xff, 0xd8),
      segment(
        0xe1,
        concat(ascii('Exif\0\0'), ascii('MM\0*'), Uint8Array.of(0, 0, 0, 8, 0, 0, 0, 0, 0, 0)),
      ),
      upright,
      baseline.subarray(2),
    );

    expect(contains(stripImageMetadata(noOrientation, 'image/jpeg'), ascii('Exif\0\0'))).toBe(
      false,
    );
  });

  test('a file that is not a JPEG at all is refused', () => {
    expect(() => stripImageMetadata(ascii('GIF89a not a jpeg'), 'image/jpeg')).toThrow(
      ImageMetadataError,
    );
  });
});

describe('a WebP', () => {
  test('its EXIF and XMP are gone, its image and colour profile are kept', () => {
    // Arrange
    const dirty = dirtyWebp();
    expect(metadataLeaks(dirty).length).toBeGreaterThan(0);

    // Act
    const stripped = stripImageMetadata(dirty, 'image/webp');

    // Assert
    expect(metadataLeaks(stripped)).toEqual([]);
    expect(contains(stripped, ascii('EXIF'))).toBe(false);
    expect(contains(stripped, ascii('XMP '))).toBe(false);
    expect(contains(stripped, ascii('ICCP'))).toBe(true);
    expect(contains(stripped, fromBase64(WEBP_BASE64).subarray(12))).toBe(true);
  });

  test('the header no longer announces what was removed, and its size is right', () => {
    const stripped = stripImageMetadata(dirtyWebp(), 'image/webp');
    const view = new DataView(stripped.buffer, stripped.byteOffset, stripped.byteLength);

    expect(view.getUint32(4, true)).toBe(stripped.length - 8);
    // VP8X comes first: its flags keep ICC (0x20) and lose EXIF (0x08) and XMP (0x04).
    expect(stripped.subarray(12, 16)).toEqual(ascii('VP8X'));
    expect(stripped[20]).toBe(0x20);
  });

  test('a WebP with nothing to remove comes back as the very same bytes', () => {
    const simple = fromBase64(WEBP_BASE64);

    expect(stripImageMetadata(simple, 'image/webp')).toBe(simple);
  });

  test('a file cut short is refused', () => {
    const dirty = dirtyWebp();

    expect(() => stripImageMetadata(dirty.subarray(0, 40), 'image/webp')).toThrow(
      ImageMetadataError,
    );
  });
});

test('the kind of file is read the way the composer reads it, whatever its case', () => {
  expect(metadataLeaks(stripImageMetadata(dirtyJpeg(baseline), 'image/JPEG'))).toEqual([]);
});

test('a kind of file the bucket does not take is passed through untouched', () => {
  const video = ascii('....ftypmp42 not an image');

  expect(stripImageMetadata(video, 'video/mp4')).toBe(video);
});
