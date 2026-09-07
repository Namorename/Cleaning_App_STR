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

/**
 * Take a photo with the camera, compressed for upload.
 *
 * Camera only, never the gallery: a photo of the flat is evidence of its
 * state at that moment, and the setting that would allow the gallery lives
 * with the manager (F10). Resolves to null when she backs out of the camera.
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
    takenAt: new Date().toISOString(),
  };
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

  const mimeType = asset.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const id = randomUUID();
  const uri = keepFile(asset.uri, id, videoExtension(mimeType));
  // The picker reports milliseconds; a recording it could not measure is
  // taken as the cap, which the camera enforced anyway.
  const durationSec =
    typeof asset.duration === 'number' && asset.duration > 0
      ? Math.round(asset.duration / 100) / 10
      : maxSeconds;

  return {
    id,
    kind: 'video',
    uri,
    mimeType,
    byteSize: await fileSize(uri),
    width: asset.width > 0 ? asset.width : null,
    height: asset.height > 0 ? asset.height : null,
    durationSec,
    takenAt: new Date().toISOString(),
  };
}
