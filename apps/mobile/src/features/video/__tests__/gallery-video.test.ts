import type { VideoLimits } from '@/features/media/schema';

import { galleryVideoRefusal, type PickedVideo } from '../gallery-video';

/**
 * A video chosen from the gallery, held to the step before anything is
 * registered (night of 2026-10-10, block 6): what the server would refuse is
 * said on the phone, in her words, with the number she has to meet.
 */

const LIMITS: VideoLimits = {
  seconds: 90,
  maxBytes: 45_000_000,
  cameraMaxBytes: 43_650_000,
  bitrate: 2_000_000,
};

function picked(overrides: Partial<PickedVideo> = {}): PickedVideo {
  return {
    uri: 'file:///cache/ImagePicker/clip.mp4',
    durationSec: 30,
    takenAt: '2026-10-10T08:00:00.000Z',
    byteSize: 10_000_000,
    mimeType: 'video/mp4',
    ...overrides,
  };
}

test.each([
  ['an MP4 within the limits', picked(), null],
  ['a MOV from an iPhone', picked({ mimeType: 'video/quicktime' }), null],
  ['exactly the step’s length', picked({ durationSec: 90 }), null],
  ['exactly the company’s size', picked({ byteSize: 45_000_000 }), null],
  [
    'longer than the step and the company allow',
    picked({ durationSec: 90.5 }),
    { key: 'video.galleryTooLong', limit: 90 },
  ],
  [
    'larger than the company allows, said in megabytes',
    picked({ byteSize: 45_000_001 }),
    { key: 'video.galleryTooLarge', limit: 45 },
  ],
  ['a length its file does not say', picked({ durationSec: 0 }), { key: 'video.galleryNoLength' }],
  [
    'a format the storage does not keep',
    picked({ mimeType: 'video/webm' }),
    { key: 'video.galleryFormat' },
  ],
])('%s', (_label, video, expected) => {
  expect(galleryVideoRefusal(video, LIMITS)).toEqual(expected);
});
