import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The repair's steps on the problem card: a photo as a picture, a video as a
 * tile, both opening the panel's viewer over the page — not, as until
 * 2026-10-09, every file as a picture, nor, as until 2026-11-12, a new tab.
 */

const PHOTO_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const VIDEO_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const PHOTO_URL = 'https://signed/h/t/photo.jpg';

const mocks = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));

vi.mock('@/lib/supabase/use-client', () => ({
  useSupabase: () => ({ storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) } }),
}));

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
      // The list signs no video: it is a tile until it is opened.
      [VIDEO_STEP]: [
        media({
          id: 'm2',
          step_id: VIDEO_STEP,
          storage_path: 'video.mp4',
          kind: 'video',
          duration_sec: 125,
          url: null,
        }),
      ],
    } as Record<string, unknown[]>,
  },
  isPending: false,
  isError: false,
  error: null,
};

vi.mock('../use-problems', () => ({
  useFixTaskSteps: () => fixSteps,
}));

import { FixTaskSteps } from '../fix-task-steps';

/** The step's own card: the item its numbered title stands in. */
const stepItem = (title: string): HTMLElement =>
  screen.getByText(new RegExp(title)).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://signed/fresh/${path}` },
    error: null,
  }));
  // jsdom has no player: a viewer closing pauses one.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the files of a repair step', () => {
  test('a video is a tile with its length; nothing of it loads in the list', () => {
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    const tile = screen.getByRole('button', { name: 'Открыть видео 1 из 1' });
    expect(tile).toHaveTextContent('2:05');
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  test('a photo is a picture that opens the viewer, not a new tab', () => {
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    const thumbnail = within(stepItem('Фото после ремонта')).getByRole('button', {
      name: 'Открыть фото 1 из 1',
    });
    expect(thumbnail.querySelector('img')).toHaveAttribute('src', PHOTO_URL);
    expect(thumbnail.closest('a')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  test('a video plays in the viewer, named after its step, from a link signed then', async () => {
    const user = userEvent.setup();
    render(<FixTaskSteps taskId="aaaaaaaa-aaaa-4aaa-8aaa-000000000001" />);

    await user.click(screen.getByRole('button', { name: 'Открыть видео 1 из 1' }));

    const video = await screen.findByLabelText('Видео 1 из 1');
    expect(video).toHaveAttribute('src', 'https://signed/fresh/video.mp4');
    expect(video).toHaveAttribute('controls');
    expect(screen.getByRole('dialog', { name: 'Видео после работы' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
