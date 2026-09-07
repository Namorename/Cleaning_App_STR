import {
  DEFAULT_MAX_PHOTOS,
  DEFAULT_MAX_VIDEO_SEC,
  DEFAULT_MIN_PHOTOS,
  canCompleteMediaStep,
  mediaKindOfStep,
  mediaOfStep,
  photoLimits,
  videoLimitSec,
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
    expect(videoLimitSec({ max_video_sec: null })).toBe(DEFAULT_MAX_VIDEO_SEC);
  });

  test('keep what the manager set', () => {
    expect(photoLimits({ min_photos: 2, max_photos: 4 })).toEqual({ min: 2, max: 4 });
    expect(videoLimitSec({ max_video_sec: 15 })).toBe(15);
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
