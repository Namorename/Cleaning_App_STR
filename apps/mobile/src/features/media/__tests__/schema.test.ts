import {
  DEFAULT_MAX_PHOTOS,
  DEFAULT_MIN_PHOTOS,
  canCompleteMediaStep,
  mediaKindOfStep,
  mediaOfStep,
  photoLimits,
  videoLimits,
  type MediaItemView,
  type TaskMedia,
} from '../schema';

const STEP_A = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';
const STEP_B = 'b1c2d3e4-2222-4222-8222-b1c2d3e40002';
const M1 = 'e6000001-0000-4000-8000-000000000001';
const M2 = 'e6000001-0000-4000-8000-000000000002';
const M3 = 'e6000001-0000-4000-8000-000000000003';
const M4 = 'e6000001-0000-4000-8000-000000000004';

function media(overrides: Partial<TaskMedia> = {}): TaskMedia {
  return {
    id: M1,
    task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    step_id: STEP_A,
    kind: 'photo',
    storage_path: `host/task/${M1}.jpg`,
    mime_type: 'image/jpeg',
    duration_sec: null,
    device_taken_at: '2026-09-07T10:00:00+00:00',
    created_at: '2026-09-07T10:00:01+00:00',
    uploaded_at: '2026-09-07T10:00:05+00:00',
    deleted_at: null,
    problem_id: null,
    ...overrides,
  };
}

function item(overrides: Partial<MediaItemView> = {}): MediaItemView {
  return {
    id: 'm1',
    kind: 'photo',
    uri: null,
    status: 'uploaded',
    durationSec: null,
    ...overrides,
  };
}

describe('mediaKindOfStep', () => {
  test('photo steps take photos, the video step a video, the rest nothing', () => {
    expect(mediaKindOfStep('photos_before')).toBe('photo');
    expect(mediaKindOfStep('photos_after')).toBe('photo');
    expect(mediaKindOfStep('video')).toBe('video');
    expect(mediaKindOfStep('checklist')).toBeNull();
    expect(mediaKindOfStep('something_new')).toBeNull();
  });
});

describe('limits', () => {
  test('fill in the server defaults where the manager set nothing', () => {
    expect(photoLimits({ min_photos: null, max_photos: null })).toEqual({
      min: DEFAULT_MIN_PHOTOS,
      max: DEFAULT_MAX_PHOTOS,
    });
  });

  test('keep what the manager set', () => {
    expect(photoLimits({ min_photos: 2, max_photos: 4 })).toEqual({ min: 2, max: 4 });
  });
});

describe('videoLimits', () => {
  // The company's three numbers as the server keeps them by default
  // (20261003170000_video_limits.sql); MB there is 10^6 bytes.
  const company = { video_max_sec: 120, video_bitrate_kbps: 2000, video_max_mb: 45 };

  test('a recording is as long as the company allows', () => {
    expect(videoLimits(company)).toEqual({
      seconds: 120,
      maxBytes: 45_000_000,
      cameraMaxBytes: 43_650_000,
      bitrate: 2_000_000,
    });
  });

  // 22.10: started cleanings kept the 90 and 120 s their steps copied from
  // the process, under the company's new 180. The company's number of now is
  // the one limit, raised or lowered (add_task_media, 20261023100000).
  test('the length follows the company, raised or lowered', () => {
    expect(videoLimits({ ...company, video_max_sec: 180 }).seconds).toBe(180);
    expect(videoLimits({ ...company, video_max_sec: 60 }).seconds).toBe(60);
  });

  test('the size and the bitrate are the company’s, in bytes and bits per second', () => {
    const roomy = { video_max_sec: 180, video_bitrate_kbps: 4500, video_max_mb: 50 };

    expect(videoLimits(roomy)).toEqual({
      seconds: 180,
      maxBytes: 50_000_000,
      cameraMaxBytes: 48_500_000,
      bitrate: 4_500_000,
    });
  });

  // 09.10 the company allowed 140 MB on Supabase Free, which takes 50 in one
  // upload: a 105.9 MB recording was made and then refused. The camera stops
  // where the storage would refuse, whichever is lower.
  test('the size stops at what the storage takes, even when the company allows more', () => {
    // More than the server lets a company set (150): the phone holds the line all the same.
    const beyond = { video_max_sec: 180, video_bitrate_kbps: 4500, video_max_mb: 200 };

    expect(videoLimits(beyond)).toEqual({
      seconds: 180,
      maxBytes: 150_000_000,
      cameraMaxBytes: 145_500_000,
      bitrate: 4_500_000,
    });
  });

  // 22.10, on Pro: the company's 140 MB is what the camera and the gallery are
  // held to, no longer the 50 of Supabase Free.
  test('on Pro the company’s own size is the limit', () => {
    const pro = { video_max_sec: 180, video_bitrate_kbps: 4500, video_max_mb: 140 };

    expect(videoLimits(pro)).toEqual({
      seconds: 180,
      maxBytes: 140_000_000,
      cameraMaxBytes: 135_800_000,
      bitrate: 4_500_000,
    });
  });

  // The camera counts what it has written; the container it closes the file
  // with comes after. Told the company's limit itself, it could hand over a
  // file the server refuses as a few kilobytes too large (`mediaTooLarge`).
  test('the camera stops 3 % short of the company’s size, in whole bytes', () => {
    const odd = { ...company, video_max_mb: 7 };

    expect(videoLimits(odd).cameraMaxBytes).toBe(6_790_000);
    expect(Number.isInteger(videoLimits(odd).cameraMaxBytes)).toBe(true);
  });
});

describe('mediaOfStep', () => {
  test('keeps the step’s own live media, in the order they were taken', () => {
    const list = [
      media({ id: M3, device_taken_at: '2026-09-07T10:02:00+00:00' }),
      media({ id: M1, device_taken_at: '2026-09-07T10:00:00+00:00' }),
      media({ id: M2, deleted_at: '2026-09-07T10:03:00+00:00' }),
      media({ id: M4, step_id: STEP_B }),
    ];

    expect(mediaOfStep(list, STEP_A).map((entry) => entry.id)).toEqual([M1, M3]);
  });

  test('falls back to creation time when the phone gave no time', () => {
    const list = [
      media({ id: M2, device_taken_at: null, created_at: '2026-09-07T10:05:00+00:00' }),
      media({ id: M1, device_taken_at: null, created_at: '2026-09-07T10:04:00+00:00' }),
    ];

    expect(mediaOfStep(list, STEP_A).map((entry) => entry.id)).toEqual([M1, M2]);
  });
});

describe('canCompleteMediaStep', () => {
  const limits = { min: 1, max: 2 };

  test('needs at least the minimum, all uploaded', () => {
    expect(canCompleteMediaStep('photo', [], limits)).toBe(false);
    expect(canCompleteMediaStep('photo', [item({ status: 'uploading' })], limits)).toBe(false);
    expect(canCompleteMediaStep('photo', [item({ status: 'failed' })], limits)).toBe(false);
    expect(canCompleteMediaStep('photo', [item()], limits)).toBe(true);
  });

  test('refuses more than the maximum', () => {
    const three = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];

    expect(canCompleteMediaStep('photo', three, limits)).toBe(false);
  });

  test('a video step wants exactly one uploaded video', () => {
    expect(canCompleteMediaStep('video', [], limits)).toBe(false);
    expect(canCompleteMediaStep('video', [item({ kind: 'video' })], limits)).toBe(true);
    expect(
      canCompleteMediaStep('video', [item({ kind: 'video', status: 'uploading' })], limits),
    ).toBe(false);
  });
});
