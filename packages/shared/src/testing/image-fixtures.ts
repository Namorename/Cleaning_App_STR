/**
 * Photos with everything a camera writes about where, when and on what it was
 * taken — for the tests of `stripImageMetadata` in both apps.
 *
 * The images themselves are real: tiny JPEGs (baseline and progressive) and a
 * WebP encoded by libvips, committed as text so no encoder is needed to run a
 * test. The metadata around them is built here, byte by byte, the way phones
 * and editors write it: an Exif block with GPS, make, model and capture time,
 * XMP, a Photoshop IPTC block, a comment, a multi-picture index and a second
 * image after the end of the first.
 *
 * Uint8Array only, no Node Buffer: the same helpers serve jest (the phone) and
 * vitest (the panel).
 */

/** 16×8, a red field with a blue bar at the left; no APP segments at all. */
export const BASELINE_JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYn' +
  'KSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo' +
  'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIABADASIAAhEBAxEB/8QAFgABAQEAAAAA' +
  'AAAAAAAAAAAAAAYH/8QAGBABAAMBAAAAAAAAAAAAAAAAAAZEgsL/xAAVAQEBAAAAAAAAAAAAAAAA' +
  'AAAEBv/EABsRAAAHAQAAAAAAAAAAAAAAAAABAwY1grIC/9oADAMBAAIRAxEAPwDIoVdx0qANfE4v' +
  'XHIv21GJW0Y//9k=';

/** The same picture, progressive: several scans, each with its own tables. */
export const PROGRESSIVE_JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYn' +
  'KSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo' +
  'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAIABADASIAAhEBAxEB/8QAFgABAQEAAAAA' +
  'AAAAAAAAAAAAAAUG/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwX/2gAMAwEAAhADEAAAAchUGv8A/8QA' +
  'FRABAQAAAAAAAAAAAAAAAAAABBD/2gAIAQEAAQUCFP/EABkRAAEFAAAAAAAAAAAAAAAAAAACBTSB' +
  'sf/aAAgBAwEBPwFtjJvT/8QAGhEAAAcAAAAAAAAAAAAAAAAAAAECBTSBsf/aAAgBAgEBPwF8nLrC' +
  'H//EABUQAQEAAAAAAAAAAAAAAAAAAAIQ/9oACAEBAAY/AnP/xAAVEAEBAAAAAAAAAAAAAAAAAADB' +
  'EP/aAAgBAQABPyEGf//aAAwDAQACAAMAAAAQ/wD/xAAWEQADAAAAAAAAAAAAAAAAAAAAYfD/2gAI' +
  'AQMBAT8QuY//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EBX/xAAUEAEAAAAAAAAAAAAA' +
  'AAAAAAAQ/9oACAEBAAE/EDv/2Q==';

/** 16×8 lossy WebP: RIFF, WEBP, one "VP8 " chunk. */
export const WEBP_BASE64 =
  'UklGRlYAAABXRUJQVlA4IEoAAACQAgCdASoQAAgAAUAmJagCdLoBQAPwArv/cAAcGAD+9GX//O03' +
  '/1+P/XWP/57zN6tr52/pc3q2va3/xZ6l0P/s4HGWEqMf97gAAA==';

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function ascii(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const u16be = (n: number) => Uint8Array.of((n >> 8) & 0xff, n & 0xff);
const u32be = (n: number) =>
  Uint8Array.of((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
const u32le = (n: number) =>
  Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);

/** A JPEG marker segment: FF, the marker, the length (with itself), the payload. */
export function segment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(Uint8Array.of(0xff, marker), u16be(payload.length + 2), payload);
}

/** GPS latitude 50° 5′ as the three RATIONALs Exif writes: the bytes that must not survive. */
export const GPS_LATITUDE_RATIONALS = concat(
  u32be(50),
  u32be(1),
  u32be(5),
  u32be(1),
  u32be(0),
  u32be(1),
);

/**
 * An Exif APP1 the way a phone writes it: big-endian TIFF, IFD0 with make,
 * model, orientation and time, an Exif IFD with the capture time, and a GPS
 * IFD with latitude and longitude.
 */
export function exifApp1(orientation: number): Uint8Array<ArrayBuffer> {
  const make = ascii('TestMake\0');
  const model = ascii('TestModel X1\0');
  const dateTime = ascii('2026:09:28 10:11:12\0');
  const original = ascii('2026:09:28 10:11:12\0');
  const longitude = concat(u32be(14), u32be(1), u32be(25), u32be(1), u32be(0), u32be(1));

  const ifdSize = (entries: number) => 2 + entries * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(6);
  const gpsAt = exifAt + ifdSize(1);
  let dataAt = gpsAt + ifdSize(4);
  const data: Uint8Array[] = [];
  const put = (bytes: Uint8Array) => {
    const at = dataAt;
    data.push(bytes);
    dataAt += bytes.length;
    return at;
  };
  const entry = (tag: number, type: number, count: number, value: Uint8Array) =>
    concat(u16be(tag), u16be(type), u32be(count), value);

  const ifd0 = [
    entry(0x010f, 2, make.length, u32be(put(make))),
    entry(0x0110, 2, model.length, u32be(put(model))),
    entry(0x0112, 3, 1, Uint8Array.of(0, orientation, 0, 0)),
    entry(0x0132, 2, dateTime.length, u32be(put(dateTime))),
    entry(0x8769, 4, 1, u32be(exifAt)),
    entry(0x8825, 4, 1, u32be(gpsAt)),
  ];
  const exif = [entry(0x9003, 2, original.length, u32be(put(original)))];
  const gps = [
    entry(0x0001, 2, 2, ascii('N\0\0\0')),
    entry(0x0002, 5, 3, u32be(put(GPS_LATITUDE_RATIONALS))),
    entry(0x0003, 2, 2, ascii('E\0\0\0')),
    entry(0x0004, 5, 3, u32be(put(longitude))),
  ];
  const ifd = (entries: Uint8Array[]) => concat(u16be(entries.length), ...entries, u32be(0));

  const tiff = concat(ascii('MM\0*'), u32be(8), ifd(ifd0), ifd(exif), ifd(gps), ...data);
  return segment(0xe1, concat(ascii('Exif\0\0'), tiff));
}

export function xmpApp1(): Uint8Array<ArrayBuffer> {
  const packet =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="50,5.0N" ' +
    'xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="TestMake"/></rdf:RDF></x:xmpmeta>';
  return segment(0xe1, ascii(`http://ns.adobe.com/xap/1.0/\0${packet}`));
}

/** Photoshop's IRB with an IPTC City (2:90). */
export function iptcApp13(): Uint8Array<ArrayBuffer> {
  const city = ascii('TestCity');
  const iptc = concat(Uint8Array.of(0x1c, 0x02, 0x5a), u16be(city.length), city);
  const irb = concat(ascii('8BIM'), u16be(0x0404), Uint8Array.of(0, 0), u32be(iptc.length), iptc);
  return segment(0xed, concat(ascii('Photoshop 3.0\0'), irb));
}

export const commentSegment = (): Uint8Array<ArrayBuffer> =>
  segment(0xfe, ascii('TestComment serial 123'));

/** The multi-picture index of a phone that stores a second image after the first. */
export const mpfApp2 = (): Uint8Array<ArrayBuffer> => segment(0xe2, ascii('MPF\0MM\0*\0\0\0\x08'));

export const jfifApp0 = (): Uint8Array<ArrayBuffer> =>
  segment(0xe0, concat(ascii('JFIF\0'), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0)));

/** A colour profile: needed to show the colours right, and kept. */
export const iccApp2 = (): Uint8Array<ArrayBuffer> =>
  segment(0xe2, concat(ascii('ICC_PROFILE\0'), Uint8Array.of(1, 1), ascii('fake profile body')));

/** What a strip must remove, as text; the GPS rationals are checked as bytes. */
export const METADATA_NEEDLES: readonly string[] = [
  'TestMake',
  'TestModel',
  '2026:09:28',
  'GPSLatitude',
  'TestCity',
  'TestComment',
  'MPF\0',
];

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

/** Which of the needles are still in the bytes. */
export function metadataLeaks(bytes: Uint8Array): string[] {
  const text = METADATA_NEEDLES.filter((needle) => indexOf(bytes, ascii(needle)) !== -1);
  return indexOf(bytes, GPS_LATITUDE_RATIONALS) === -1
    ? text
    : [...text, '<GPS latitude rationals>'];
}

/**
 * A photo as a phone hands it over: every kind of metadata before the image,
 * and a second image with its own Exif after the end of the first.
 */
export function dirtyJpeg(clean: Uint8Array, orientation = 6): Uint8Array<ArrayBuffer> {
  const body = clean.subarray(2);
  const second = concat(Uint8Array.of(0xff, 0xd8), exifApp1(1), body);
  return concat(
    Uint8Array.of(0xff, 0xd8),
    jfifApp0(),
    exifApp1(orientation),
    xmpApp1(),
    mpfApp2(),
    iccApp2(),
    iptcApp13(),
    commentSegment(),
    body,
    second,
  );
}

/** From the first scan to the end of the image: what a strip must leave byte for byte. */
export function scanData(jpeg: Uint8Array): Uint8Array {
  for (let i = 2; i + 1 < jpeg.length; i += 1) {
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) {
      for (let end = jpeg.length - 2; end > i; end -= 1) {
        if (jpeg[end] === 0xff && jpeg[end + 1] === 0xd9) {
          return jpeg.subarray(i, end + 2);
        }
      }
    }
  }
  throw new Error('no scan in this JPEG');
}

/**
 * A JPEG whose scan uses restart markers (DRI, then RST inside the entropy
 * data), byte stuffing and a fill byte. Not decodable — the tables are
 * placeholders — but structured exactly as the walk has to read it.
 */
export function restartJpeg(): Uint8Array<ArrayBuffer> {
  const dqt = segment(0xdb, concat(Uint8Array.of(0), new Uint8Array(64).fill(1)));
  const sof = segment(0xc0, Uint8Array.of(8, 0, 8, 0, 16, 1, 1, 0x11, 0));
  const dht = segment(0xc4, concat(Uint8Array.of(0), new Uint8Array(16)));
  const dri = segment(0xdd, Uint8Array.of(0, 1));
  const sos = segment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0));
  const entropy = Uint8Array.of(
    0x12,
    0xff,
    0x00,
    0x34,
    0xff,
    0xd0,
    0x56,
    0xff,
    0xd1,
    0x78,
    0xff,
    0xff,
    0xd2,
    0x9a,
  );
  return concat(
    Uint8Array.of(0xff, 0xd8),
    exifApp1(1),
    dqt,
    sof,
    dht,
    dri,
    sos,
    entropy,
    Uint8Array.of(0xff, 0xd9),
  );
}

function chunk(id: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const pad = data.length % 2 === 1 ? Uint8Array.of(0) : new Uint8Array(0);
  return concat(ascii(id), u32le(data.length), data, pad);
}

/**
 * A WebP with EXIF and XMP chunks: extended (VP8X) form, the image chunk of
 * the committed WebP, a colour profile to keep, and the metadata to drop.
 */
export function dirtyWebp(): Uint8Array<ArrayBuffer> {
  const simple = fromBase64(WEBP_BASE64);
  const image = simple.subarray(12);
  // Flags: ICC (0x20), EXIF (0x08), XMP (0x04); canvas 16×8, stored minus one.
  const vp8x = chunk('VP8X', Uint8Array.of(0x2c, 0, 0, 0, 15, 0, 0, 7, 0, 0));
  const iccp = chunk('ICCP', ascii('fake profile'));
  const exif = chunk('EXIF', exifApp1(6).subarray(10));
  const xmp = chunk('XMP ', ascii('<x:xmpmeta tiff:Make="TestMake" exif:GPSLatitude="50,5.0N"/>'));
  const body = concat(ascii('WEBP'), vp8x, iccp, image, exif, xmp);
  return concat(ascii('RIFF'), u32le(body.length), body);
}
