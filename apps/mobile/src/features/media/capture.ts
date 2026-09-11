import { randomUUID } from 'expo-crypto';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fileSize, keepFile } from './file';
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
}

export class CameraDeniedError extends Error {
  override readonly name = 'CameraDeniedError';
}

export class MediaLibraryDeniedError extends Error {
  override readonly name = 'MediaLibraryDeniedError';
}

/**
 * A recording from the gallery that the step will not accept.
 *
 * The camera caps its own recording (`videoMaxDuration`); the gallery hands
 * over whatever was picked, so the length is checked here — before the file
 * is copied and registered, rather than as a refusal from the server after
 * an upload the cleaner waited for.
 */
export class VideoTooLongError extends Error {
  override readonly name = 'VideoTooLongError';
  constructor(readonly maxSeconds: number) {
    super(`The video is longer than ${maxSeconds} seconds`);
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
): Promise<CapturedMedia> {
  const compressed = await manipulateAsync(
    asset.uri,
    [{ resize: resizeTarget(asset.width, asset.height) }],
    { compress: PHOTO_QUALITY, format: SaveFormat.JPEG },
  );

  const id = randomUUID();
  const uri = keepFile(compressed.uri, id, 'jpg');

  return {
    id,
    kind: 'photo',
    uri,
    mimeType: 'image/jpeg',
    byteSize: await fileSize(uri),
    width: compressed.width,
    height: compressed.height,
    durationSec: null,
    takenAt,
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

  return toPhoto(asset, new Date().toISOString());
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

  return toPhoto(asset, exifTakenAt(asset.exif) ?? new Date().toISOString());
}

/** The extension the server will give the file, from what the camera said. */
function videoExtension(mimeType: string): string {
  return mimeType === 'video/quicktime' ? 'mov' : 'mp4';
}

/**
 * Record a video with the camera, no longer than the step allows.
 *
 * The length is capped by the camera itself (`videoMaxDuration`), so a
 * recording cannot come back too long. 720p is asked for where the platform
 * lets us ask (iOS); Android records at its default and the server bounds
 * the size.
 */
export async function captureVideo(maxSeconds: number): Promise<CapturedMedia | null> {
  await ensureCameraPermission();

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: maxSeconds,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
  });
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (asset === null) {
    return null;
  }

  return toVideo(asset, maxSeconds, new Date().toISOString());
}

/** Seconds of a picked recording, or null when the picker could not measure it. */
function measuredSeconds(asset: ImagePicker.ImagePickerAsset): number | null {
  // The picker reports milliseconds, rounded here to a tenth of a second.
  return typeof asset.duration === 'number' && asset.duration > 0
    ? Math.round(asset.duration / 100) / 10
    : null;
}

function toVideo(
  asset: ImagePicker.ImagePickerAsset,
  fallbackSeconds: number,
  takenAt: string,
): Promise<CapturedMedia> {
  const mimeType = asset.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const id = randomUUID();
  const uri = keepFile(asset.uri, id, videoExtension(mimeType));

  return fileSize(uri).then((byteSize) => ({
    id,
    kind: 'video' as const,
    uri,
    mimeType,
    byteSize,
    width: asset.width > 0 ? asset.width : null,
    height: asset.height > 0 ? asset.height : null,
    durationSec: measuredSeconds(asset) ?? fallbackSeconds,
    takenAt,
  }));
}

/**
 * Choose a video from the gallery.
 *
 * The library has no `videoMaxDuration` — that setting belongs to the
 * camera — so the length is checked here and a recording that is too long is
 * refused before anything is copied. A recording the picker could not
 * measure is let through: the server bounds the size, and refusing a file on
 * a measurement that does not exist would strand a cleaner with no way past.
 */
export async function pickVideoFromGallery(maxSeconds: number): Promise<CapturedMedia | null> {
  await ensureLibraryPermission();

  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], exif: true });
  const asset = result.canceled ? null : (result.assets[0] ?? null);
  if (asset === null) {
    return null;
  }

  const seconds = measuredSeconds(asset);
  if (seconds !== null && seconds > maxSeconds) {
    throw new VideoTooLongError(maxSeconds);
  }

  return toVideo(asset, maxSeconds, exifTakenAt(asset.exif) ?? new Date().toISOString());
}
