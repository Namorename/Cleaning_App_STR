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
    isCompressed: false,
    pickerCopies: [],
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

// The iPhone's gallery hands a video over compressed to 720p H.264
// (pickVideoFromGallery): one still too large after that says so, and asks for
// a shorter one — a smaller one of the same length is not to be had.
describe('a video the gallery already compressed', () => {
  test('still too large: said as too large even compressed, in megabytes', () => {
    expect(
      galleryVideoRefusal(picked({ byteSize: 45_000_001, isCompressed: true }), LIMITS),
    ).toEqual({ key: 'video.galleryTooLargeCompressed', limit: 45 });
  });

  test('within the size: goes', () => {
    expect(
      galleryVideoRefusal(picked({ byteSize: 45_000_000, isCompressed: true }), LIMITS),
    ).toBeNull();
  });

  test('the other checks are asked as before', () => {
    expect(galleryVideoRefusal(picked({ durationSec: 91, isCompressed: true }), LIMITS)).toEqual({
      key: 'video.galleryTooLong',
      limit: 90,
    });
    expect(
      galleryVideoRefusal(picked({ mimeType: 'video/webm', isCompressed: true }), LIMITS),
    ).toEqual({ key: 'video.galleryFormat' });
  });

  test('the size is the smaller of the company’s and the storage’s 50 MB', () => {
    const generous: VideoLimits = { ...LIMITS, maxBytes: 50_000_000 };

    expect(
      galleryVideoRefusal(picked({ byteSize: 50_000_001, isCompressed: true }), generous),
    ).toEqual({ key: 'video.galleryTooLargeCompressed', limit: 50 });
  });
});
