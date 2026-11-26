import type { MediaKind } from '@/features/media/schema';
import { withoutMetadata } from '@/lib/media-upload';

/**
 * The files the office picks for a task (20261126100000), checked here before a row is written:
 * the server refuses the same, but a refusal after the upload has started costs the manager a
 * wait. The numbers mirror the server's.
 */

/** task_media_max_bytes('photo'). */
export const OFFICE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
/** task_media_max_bytes('video'): the bucket's own ceiling, under the company's plan. */
export const OFFICE_VIDEO_MAX_BYTES = 150 * 1024 * 1024;
/** task_media_video_tolerance_sec(): a phone's timer, a second over the camera's limit. */
export const VIDEO_TOLERANCE_SEC = 2;

/** The two video types the bucket takes (task_media_extension). */
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;

/**
 * The longest edge a photo is sent at and its quality: the phone's (apps/mobile capture.ts,
 * MAX_PHOTO_EDGE, PHOTO_QUALITY), so a picture from the office weighs what one from the field does.
 */
export const OFFICE_PHOTO_EDGE = 1600;
export const OFFICE_PHOTO_QUALITY = 0.8;

/** How long a browser may take to read a video's length before the file counts as unreadable. */
const VIDEO_READ_MS = 15_000;

/** The company's video limits (hosts.video_max_sec, hosts.video_max_mb). */
export interface VideoLimits {
  maxSec: number;
  maxMb: number;
}

/** Why a file is not taken, as the screen says it; null: taken. */
export type FileRefusal =
  | { key: 'notMedia' }
  | { key: 'tooLarge'; limit: number }
  | { key: 'videoTooLong'; limit: number }
  | { key: 'videoUnreadable' };

/** What a picked file is: a photo, a video of a type the bucket takes, or nothing we send. */
export function officeFileKind(file: { type: string }): MediaKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) {
    return 'photo';
  }
  return (VIDEO_TYPES as readonly string[]).includes(type) ? 'video' : null;
}

/** A video's limit in bytes: the company's megabytes (of 1 000 000), under the bucket's ceiling. */
export function videoMaxBytes(limits: VideoLimits): number {
  return Math.min(OFFICE_VIDEO_MAX_BYTES, limits.maxMb * 1_000_000);
}

/**
 * Whether a file prepared for sending is taken: its size and, for a video, its length.
 * `limits` null: the company's limits are not known yet — the bucket's ceiling holds, and the
 * server decides the rest.
 */
export function refusalOf(
  file: { size: number },
  kind: MediaKind,
  durationSec: number | null,
  limits: VideoLimits | null,
): FileRefusal | null {
  if (kind === 'photo') {
    return file.size > OFFICE_PHOTO_MAX_BYTES
      ? { key: 'tooLarge', limit: Math.floor(OFFICE_PHOTO_MAX_BYTES / (1024 * 1024)) }
      : null;
  }
  const maxBytes = limits === null ? OFFICE_VIDEO_MAX_BYTES : videoMaxBytes(limits);
  if (file.size > maxBytes) {
    return {
      key: 'tooLarge',
      limit: limits === null ? Math.floor(maxBytes / (1024 * 1024)) : Math.floor(maxBytes / 1_000_000),
    };
  }
  if (durationSec === null) {
    return { key: 'videoUnreadable' };
  }
  if (limits !== null && durationSec > limits.maxSec + VIDEO_TOLERANCE_SEC) {
    return { key: 'videoTooLong', limit: limits.maxSec };
  }
  return null;
}

/** The size a picture is drawn at: its longest edge no longer than `edge`, never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= edge) {
    return { width, height };
  }
  const scale = edge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A name for the JPEG a picture becomes: its own, with the extension it now has. */
function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/**
 * The photo as it is sent: drawn again as a JPEG no larger than the phone sends (which also
 * leaves behind what the camera wrote into it — place, time, phone). A picture the browser cannot
 * draw: a JPEG or a WebP goes as it is, without its metadata; anything else is not a photo we
 * can send, and throws.
 */
export async function preparePhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height, OFFICE_PHOTO_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('No 2D context to draw the photo on');
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', OFFICE_PHOTO_QUALITY),
    );
    if (blob === null) {
      throw new Error('The photo could not be encoded');
    }
    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch (error: unknown) {
    const type = file.type.toLowerCase();
    if (type === 'image/jpeg' || type === 'image/webp') {
      return withoutMetadata(file);
    }
    throw error;
  }
}

/**
 * A video's length in seconds, read from its own metadata by the browser; null when the browser
 * cannot read it (a codec it does not know, a broken file) in time.
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let isSettled = false;
    const settle = (seconds: number | null) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = setTimeout(() => settle(null), VIDEO_READ_MS);
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      settle(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => settle(null);
    video.src = url;
  });
}
