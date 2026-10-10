import type { PickedVideo } from '@/features/media/capture';
import type { VideoLimits } from '@/features/media/schema';

/** The containers the storage keeps (the bucket's allowed types). */
const KEPT_TYPES: readonly string[] = ['video/mp4', 'video/quicktime'];
const BYTES_PER_MB = 1_000_000;

export type { PickedVideo };

/** Why a chosen video cannot be sent, as a key of `video.*` and the number to meet. */
export interface GalleryRefusal {
  key: 'video.galleryTooLong' | 'video.galleryTooLarge' | 'video.galleryNoLength' | 'video.galleryFormat';
  limit?: number;
}

/**
 * What the server would refuse of a video from the gallery, said before
 * anything is registered (night of 2026-10-10, block 6): a container the
 * storage does not keep, a length its file does not say, longer than the
 * step and the company allow (`limits.seconds`, the smaller of the two),
 * larger than the company's size. A camera recording is held to these by the
 * camera itself; a chosen file is held here. Null when it may go.
 */
export function galleryVideoRefusal(video: PickedVideo, limits: VideoLimits): GalleryRefusal | null {
  if (!KEPT_TYPES.includes(video.mimeType.toLowerCase())) {
    return { key: 'video.galleryFormat' };
  }
  if (!(video.durationSec > 0)) {
    return { key: 'video.galleryNoLength' };
  }
  if (video.durationSec > limits.seconds) {
    return { key: 'video.galleryTooLong', limit: limits.seconds };
  }
  if (video.byteSize > limits.maxBytes) {
    return { key: 'video.galleryTooLarge', limit: Math.floor(limits.maxBytes / BYTES_PER_MB) };
  }
  return null;
}
