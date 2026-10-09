import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { taskSchema } from '../schema';

/**
 * What the drawer shows of a step's files: a photo as a picture, a video as a
 * player. Until 2026-10-09 every file was an <img>, and a video came out as a
 * broken picture.
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

const videoRows = [
  media({
    id: 'm2',
    step_id: VIDEO_STEP,
    storage_path: 'video.mp4',
    kind: 'video',
    duration_sec: 65,
    url: VIDEO_URL,
  }),
];

const work = {
  data: {
    steps: [
      step(PHOTO_STEP, 'photos_after', 'Фото после уборки', 1),
      step(VIDEO_STEP, 'video', 'Видео после работы', 2),
    ],
    mediaByStep: {
      [PHOTO_STEP]: [media({ id: 'm1', storage_path: 'photo.jpg', url: PHOTO_URL })],
      [VIDEO_STEP]: videoRows,
    } as Record<string, unknown[]>,
  },
  isPending: false,
  isError: false,
};

beforeEach(() => {
  work.data.mediaByStep[VIDEO_STEP] = videoRows;
});

vi.mock('../use-tasks', () => ({
  useTaskWork: () => work,
  useTaskProblems: () => ({ data: [], isPending: false, isError: false }),
  useSetDuration: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
}));

import { TaskDrawer } from '../task-drawer';

const finished = taskSchema.parse({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  property_id: 1,
  reservation_id: null,
  problem_id: null,
  type: 'cleaning',
  status: 'done',
  priority: 0,
  assignee_id: null,
  created_by: null,
  scheduled_date: '2026-10-09',
  time_from: null,
  time_to: null,
  started_at: '2026-10-09T08:00:00+00:00',
  completed_at: '2026-10-09T09:35:00+00:00',
  measured_minutes: 95,
  duration_override_min: null,
  is_parallel: false,
  is_short_measurement: null,
  notes: null,
  title: null,
  title_i18n: null,
  created_at: '2026-10-09T07:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  assignee: { full_name: 'Maria Test', role: 'cleaner' },
  author: null,
});

const stepItem = (title: string): HTMLElement =>
  screen.getAllByRole('listitem').find((item) => item.textContent?.includes(title)) as HTMLElement;

describe('the files of a step in the task drawer', () => {
  test('a video plays in a player with controls, from its signed link', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const video = within(stepItem('Видео после работы')).getByLabelText(
      'Видео: Видео после работы',
    );
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', VIDEO_URL);
    expect(video).toHaveAttribute('controls');
    expect(within(stepItem('Видео после работы')).getByText('Видео · 1:05')).toBeInTheDocument();
  });

  test('a video is not counted as a photo, and is never drawn as a picture', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Видео после работы');
    expect(within(item).queryByText(/фото/i)).not.toBeInTheDocument();
    expect(item.querySelector('img')).toBeNull();
  });

  test('a photo is still a picture that opens in a new tab', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Фото после уборки');
    const image = item.querySelector('img');
    expect(image).toHaveAttribute('src', PHOTO_URL);
    expect(image?.closest('a')).toHaveAttribute('href', PHOTO_URL);
    expect(item.querySelector('video')).toBeNull();
  });

  // Until the fix the drawer dropped such a video without a word, and the
  // step looked as if nothing had been filmed on it.
  test('a video storage would not sign says so, as on the problem card', () => {
    work.data.mediaByStep[VIDEO_STEP] = [
      media({ id: 'm3', step_id: VIDEO_STEP, kind: 'video', duration_sec: 30, url: null }),
    ];
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Видео после работы');
    expect(item.querySelector('video')).toBeNull();
    expect(within(item).getByText('Видео недоступно')).toBeInTheDocument();
  });
});
