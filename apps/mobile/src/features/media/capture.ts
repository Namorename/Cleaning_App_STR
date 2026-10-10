import { randomUUID } from 'expo-crypto';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { noteStep } from '@/lib/sentry';

import {
  discardFile,
  fileName,
  fileSize,
  keepFile,
  pickerFolderVideos,
  stripKeptPhoto,
} from './file';
import type { MediaKind } from './schema';

/**
 * Longest edge of a photo after compression.
 *
 * A dirty sink is readable at 1600 pixels and the file is a few hundred
 * kilobytes instead of several megabytes — the difference between an upload
 * that finishes in the stairwell and one that does not.
 */
export const MAX_PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;

/**
 * Where a file came from, as the app declares it to the server.
 *
 * Known here and nowhere else: by the time the row is written, a picked file
 * and a taken one look exactly alike. It used to be dropped at this boundary,
 * which is why the gallery had to stay shut — a manager could not tell a photo
 * of the flat from a photo of a photo.
 */
export type MediaSource = 'camera' | 'gallery';

/** What the camera produced, ready to be registered and uploaded. */
export interface CapturedMedia {
  id: string;
  kind: MediaKind;
  uri: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  takenAt: string;
  source: MediaSource;
}

export class CameraDeniedError extends Error {
  override readonly name = 'CameraDeniedError';
}

export class MediaLibraryDeniedError extends Error {
  override readonly name = 'MediaLibraryDeniedError';
}

/**
 * A capture that measured zero bytes.
 *
 * The server refuses such a row, and rightly so — but it cannot say anything
 * useful about why the phone offered it, so the refusal comes back as a
 * sentence about file types that has nothing to do with what happened. It is
 * caught here instead, before anything is registered or uploaded, where the
 * cause is still in reach: the file was not where it was measured.
 */
export class EmptyCaptureError extends Error {
  override readonly name = 'EmptyCaptureError';
  constructor(uri: string) {
    super(`The capture at ${uri} measured zero bytes`);
  }
}

async function ensureCameraPermission(): Promise<void> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) {
    return;
  }
  const requested = await ImagePicker.requestCameraPermissionsAsync();
  if (!requested.granted) {
    throw new CameraDeniedError('Camera permission was not granted');
  }
}

async function ensureLibraryPermission(): Promise<void> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) {
    return;
  }
  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!requested.granted) {
    throw new MediaLibraryDeniedError('Media library permission was not granted');
  }
}

/**
 * When the photograph was actually taken, if it says so.
 *
 * This matters more for a file from the gallery than for anything else on
 * this screen. A picture chosen from the roll may have been taken in another
 * flat, or a week ago, and `device_taken_at` is the one column that would
 * show it — stamping it with the moment of the upload would erase the only
 * trace. EXIF writes `YYYY:MM:DD HH:MM:SS` in local time with colons in the
 * date; anything else, or nothing at all, answers null and the caller falls
 * back to now.
 */
export function exifTakenAt(exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') {
    return null;
  }
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const taken = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(taken.getTime()) ? null : taken.toISOString();
}

/** Fit the longest edge into MAX_PHOTO_EDGE, keeping the aspect ratio. */
export function resizeTarget(
  width: number,
  height: number,
): { width: number } | { height: number } {
  if (width >= height) {
    return { width: Math.min(width, MAX_PHOTO_EDGE) };
  }
  return { height: Math.min(height, MAX_PHOTO_EDGE) };
}

/** Compress whatever was picked and keep it under an id of our own. */
async function toPhoto(
  asset: ImagePicker.ImagePickerAsset,
  takenAt: string,
  source: MediaSource,
): Promise<CapturedMedia> {
  const compressed = await manipulateAsync(
    asset.uri,
    [{ resize: resizeTarget(asset.width, asset.height) }],
    { compress: PHOTO_QUALITY, format: SaveFormat.JPEG },
  );

  const id = randomUUID();
  const uri = await keepFile(compressed.uri, id, 'jpg');
  await stripKeptPhoto(uri);
  const byteSize = await fileSize(uri);
  if (byteSize <= 0) {
    throw new EmptyCaptureError(uri);
  }

  return {
    id,
    kind: 'photo',
    uri,
    mimeType: 'image/jpeg',
    byteSize,
    width: compressed.width,
    height: compressed.height,
    durationSec: null,
    takenAt,
    source,
  };
}

/**
 * Take a photo with the camera, compressed for upload.
 *
 * The camera is always available; the gallery is the one that has to be
 * allowed (`hosts.gallery_allowed`, set by the manager in F10). A photo
 * taken here is evidence of the flat at this moment, which is why it is
 * stamped with now. Resolves to null when she backs out of the camera.
 */
export async function capturePhoto(): Promise<CapturedMedia | null> {
  await ensureCameraPermission();

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (asset === null) {
    return null;
  }

  return toPhoto(asset, new Date().toISOString(), 'camera');
}

/**
 * Choose a photo from the gallery.
 *
 * Only reachable when the company has allowed it. The file is asked for with
 * its EXIF so that `device_taken_at` can say when the picture was really
 * taken: a manager who turned the gallery on accepted that a photo might not
 * be of this cleaning, and the one thing that must not happen is the app
 * quietly claiming that it is.
 */
export async function pickPhotoFromGallery(): Promise<CapturedMedia | null> {
  await ensureLibraryPermission();

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: true,
  });
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (asset === null) {
    return null;
  }

  return toPhoto(asset, exifTakenAt(asset.exif) ?? new Date().toISOString(), 'gallery');
}

/** The container of a recording, from the file the camera wrote: QuickTime on an iPhone. */
export function videoMimeType(uri: string): 'video/mp4' | 'video/quicktime' {
  return /\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4';
}

/** The extension the server will give the file, from its container. */
function videoExtension(mimeType: string): string {
  return mimeType === 'video/quicktime' ? 'mov' : 'mp4';
}

/** What the recording screen hands over: the camera's file and what it measured. */
export interface Recording {
  /** Where the camera wrote the file, in the cache. */
  uri: string;
  /** Timed by the screen — the camera does not report it. */
  durationSec: number;
  /** When the recording started. */
  takenAt: string;
}

/**
 * Keep a video under an id of ours, ready to be registered and uploaded like a
 * photo: a recording of the app's own camera, or — where the company allows
 * the gallery — a copy the gallery handed over (night of 2026-10-10, block 6).
 *
 * The camera reports only where it wrote the file (`recordAsync`): the length
 * is what the recording screen timed, the picture's size is not known and is
 * not declared. A file from the gallery brings its length and type from its
 * own metadata (`pickVideoFromGallery`), and says where it came from.
 */
export async function keepRecording(
  recording: Recording,
  source: MediaSource = 'camera',
  mimeType: string = videoMimeType(recording.uri),
): Promise<CapturedMedia> {
  const id = randomUUID();
  const uri = await keepFile(recording.uri, id, videoExtension(mimeType));
  const byteSize = await fileSize(uri);
  if (byteSize <= 0) {
    // Nothing to send and nothing to send again: not left in the documents.
    discardFile(uri);
    throw new EmptyCaptureError(uri);
  }

  return {
    id,
    kind: 'video',
    uri,
    mimeType,
    byteSize,
    width: null,
    height: null,
    durationSec: recording.durationSec,
    takenAt: recording.takenAt,
    source,
  };
}

const MS_PER_SECOND = 1000;

/** A video chosen from the gallery: where its copy is, and what its file says of it. */
export interface PickedVideo extends Recording {
  byteSize: number;
  mimeType: string;
  /** Handed over compressed to 720p H.264 (an iPhone's picker): a size still too large says so. */
  isCompressed: boolean;
  /**
   * The picker's other copies of this choice in its folder of the cache — an
   * iPhone's copy of the original, made before it compressed — for the screen
   * to let go of once the video is kept (owner's word of 2026-10-10, 23:45).
   */
  pickerCopies: readonly string[];
}

/** The video as the gallery holds it: Android always, an iPhone when it cannot compress it. */
const ORIGINAL_VIDEO: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], quality: 1 };

/**
 * The video as an iPhone's gallery is asked for it. An iPhone films 4K HEVC,
 * and a minute of it is far past the storage's 50 MB
 * (docs/ios-first-device-checklist.md, risk 3): its picker compresses the copy
 * to 720p H.264 as it hands it over — an `.mp4`, in the storage's own terms.
 * Only JavaScript: the setting is the picker's own. Built when asked, not at
 * import: the picker's enums are read on an iPhone only.
 */
function compressedVideo(): ImagePicker.ImagePickerOptions {
  return { ...ORIGINAL_VIDEO, videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720 };
}

/** What the iPhone's picker says when it could not compress the chosen video. */
const COMPRESSION_FAILURES: ReadonlySet<string> = new Set([
  'ERR_FAILED_TO_TRANSCODE_VIDEO',
  'ERR_UNSUPPORTED_VIDEO_EXPORT_PRESET',
]);

function isCompressionFailure(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' && COMPRESSION_FAILURES.has(code);
}

/**
 * The gallery asked for a video: on an iPhone compressed, and — when the
 * iPhone cannot compress the one chosen (owner's word of 2026-10-10, 23:45) —
 * asked again for the original, held then to the same checks and refused in
 * the same words. Every other failure is said as it was.
 */
async function launchVideoGallery(): Promise<{
  result: ImagePicker.ImagePickerResult;
  isCompressed: boolean;
}> {
  if (Platform.OS !== 'ios') {
    return {
      result: await ImagePicker.launchImageLibraryAsync(ORIGINAL_VIDEO),
      isCompressed: false,
    };
  }
  try {
    return {
      result: await ImagePicker.launchImageLibraryAsync(compressedVideo()),
      isCompressed: true,
    };
  } catch (error: unknown) {
    if (!isCompressionFailure(error)) {
      throw error;
    }
    noteStep('video.gallery', 'uncompressed', { code: (error as { code: string }).code });
    return {
      result: await ImagePicker.launchImageLibraryAsync(ORIGINAL_VIDEO),
      isCompressed: false,
    };
  }
}

/**
 * The videos that appeared in the picker's folder while she chose, other than
 * the one handed over: the copies of this choice, and nothing older. None
 * when the folder could not be read before or after — what was there already
 * cannot then be told from what this choice made.
 */
function pickerCopiesOf(
  before: ReadonlyMap<string, string> | null,
  handedOver: string,
): readonly string[] {
  const after = before === null ? null : pickerFolderVideos();
  if (before === null || after === null) {
    return [];
  }
  const handedOverName = fileName(handedOver);
  return [...after]
    .filter(([name]) => !before.has(name) && name !== handedOverName)
    .map(([, uri]) => uri);
}

/**
 * Choose a video from the gallery (night of 2026-10-10, block 6).
 *
 * Only reachable where the company allows the gallery, and only once the
 * phone has let the app into the photos — asked here, before the gallery
 * opens. The picker hands over a copy in the app's cache — on an iPhone
 * compressed (`launchVideoGallery`) — with the length and type its file says;
 * a size it does not say is measured. The moment it is chosen stands for when
 * it was taken: a video's own date is not read here, and the manager who
 * opened the gallery accepted that a file from it may not be of this
 * cleaning. Resolves to null when she backs out of the gallery. Nothing is
 * deleted here: the picker's other copies are named (`pickerCopies`).
 */
export async function pickVideoFromGallery(): Promise<PickedVideo | null> {
  await ensureLibraryPermission();

  const before = pickerFolderVideos();
  const { result, isCompressed } = await launchVideoGallery();
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (asset === null) {
    return null;
  }

  return {
    uri: asset.uri,
    durationSec: (asset.duration ?? 0) / MS_PER_SECOND,
    takenAt: new Date().toISOString(),
    byteSize: asset.fileSize ?? (await fileSize(asset.uri)),
    mimeType: asset.mimeType ?? videoMimeType(asset.uri),
    isCompressed,
    pickerCopies: pickerCopiesOf(before, asset.uri),
  };
}
