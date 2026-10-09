import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The repair's steps on the problem card: a photo as a picture, a video as a
 * player — not, as until 2026-10-09, every file as a picture.
 */

const PHOTO_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const VIDEO_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const PHOTO_URL = 'https://signed/h/t/photo.jpg';
const VIDEO_URL = 'https://signed/h/t/video.mp4';

const step = (id: string, type: string, title: string, sortOrder: number) => ({
  id,
  sort_order: sortOrder,
  type,
  required: true,
  title,
  title_i18n: null,
  completed_at: '2026-10-09T09:30:00+00:00',
  skipped_at: null,
  waived_at: null,
});

const media = (overrides: Record<string, unknown>) => ({
  step_id: PHOTO_STEP,
  created_at: '2026-10-09T09:00:00+00:00',
  source: 'camera',
  kind: 'photo',
  duration_sec: null,
  ...overrides,
});

const fixSteps = {
  data: {
    steps: [
      step(PHOTO_STEP, 'photos_after', 'Фото после ремонта', 1),
      step(VIDEO_STEP, 'video', 'Видео после работы', 2),
    ],
    mediaByStep: {
      [PHOTO_STEP]: [media({ id: 'm1', storage_path: 'photo.jpg', url: PHOTO_URL })],
      [VIDEO_STEP]: [
        media({
          id: 'm2',
          step_id: VIDEO_STEP,
          storage_path: 'video.mp4',
          kind: 'video',
          duration_sec: 125,
          url: VIDEO_URL,
        }),
      ],
    } as Record<string, unknown[]>,
  },
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(() => Promise.resolve()),
};

vi.mock('../use-problems', () => ({
  useFixTaskSteps: () => fixSteps,
}));

import { FixTaskSteps } from '../fix-task-steps';

/** The step's own card: the item its numbered title stands in. */
const stepItem = (title: string): HTMLElement =>
  screen.getByText(new RegExp(title)).closest('li') as HTMLElement;

const videoRows = fixSteps.data.mediaByStep[VIDEO_STEP];

beforeEach(() => {
  vi.clearAllMocks();
  fixSteps.data.mediaByStep[VIDEO_STEP] = videoRows;
});

describe('the files of a repair step', () => {
  test('a video plays in a player with controls, from its signed link', () => {
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    const video = screen.getByLabelText('Видео: Видео после работы');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', VIDEO_URL);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByText('Видео · 2:05')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть видео в новой вкладке' })).toHaveAttribute(
      'href',
      VIDEO_URL,
    );
  });

  test('a photo is still a picture that opens in a new tab', () => {
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    const image = within(stepItem('Фото после ремонта')).getByRole('img');
    expect(image).toHaveAttribute('src', PHOTO_URL);
    expect(image.closest('a')).toHaveAttribute('href', PHOTO_URL);
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  test('a video storage would not sign says so instead of a dead player', () => {
    fixSteps.data.mediaByStep[VIDEO_STEP] = [
      media({ id: 'm3', step_id: VIDEO_STEP, kind: 'video', duration_sec: 30, url: null }),
    ];
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
  });

  // The link lives an hour; the card may stand open longer.
  test('a video whose link has expired has the steps read again', () => {
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    const video = screen.getByLabelText('Видео: Видео после работы');
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
    fireEvent.error(video);

    expect(fixSteps.refetch).toHaveBeenCalledTimes(1);
    expect(fixSteps.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });
});
