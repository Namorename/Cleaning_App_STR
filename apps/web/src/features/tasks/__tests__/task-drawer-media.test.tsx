import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { taskSchema } from '../schema';

/**
 * What the drawer shows of a step's files: a photo as a picture, a video as
 * a tile, both opening the panel's viewer over the drawer. Until 2026-10-09
 * every file was an <img>, and a video came out as a broken picture; until
 * 2026-11-12 a photo opened in a new tab and a video played in the list.
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

// The list signs no video: it is a tile until it is opened.
const videoRows = [
  media({
    id: 'm2',
    step_id: VIDEO_STEP,
    storage_path: 'video.mp4',
    kind: 'video',
    duration_sec: 65,
    url: null,
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
  refetch: vi.fn(() => Promise.resolve()),
};

beforeEach(() => {
  vi.clearAllMocks();
  work.data.mediaByStep[VIDEO_STEP] = videoRows;
  work.data.mediaByStep[PHOTO_STEP] = [
    media({ id: 'm1', storage_path: 'photo.jpg', url: PHOTO_URL }),
  ];
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

vi.mock('../use-tasks', () => ({
  useCleaners: () => ({ data: [], isPending: false, isError: false }),
  useTask: () => ({ data: undefined, isPending: false, isError: false }),
  useNameCleaningWorker: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
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
  test('a video is a tile with its length, and nothing of it loads in the list', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Видео после работы');
    const tile = within(item).getByRole('button', { name: 'Открыть видео 1 из 1' });
    expect(tile).toHaveTextContent('1:05');
    expect(item.querySelector('video')).toBeNull();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  test('a video is not counted as a photo, and is never drawn as a picture', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Видео после работы');
    expect(within(item).queryByText(/фото/i)).not.toBeInTheDocument();
    expect(item.querySelector('img')).toBeNull();
  });

  test('a photo is a picture that opens the viewer, not a new tab', () => {
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Фото после уборки');
    const image = item.querySelector('img');
    expect(image).toHaveAttribute('src', PHOTO_URL);
    expect(image?.closest('a')).toBeNull();
    expect(image?.closest('button')).toHaveAccessibleName('Открыть фото 1 из 1');
    expect(item.querySelector('video')).toBeNull();
  });

  // Until the fix the drawer counted such a photo in «Фото: N» and then drew
  // nothing for it, so the count and the pictures disagreed.
  test('a photo storage would not sign says so, and the count is what is shown', () => {
    work.data.mediaByStep[PHOTO_STEP] = [
      media({ id: 'm1', storage_path: 'photo.jpg', url: PHOTO_URL }),
      media({ id: 'm4', storage_path: 'gone.jpg', url: null }),
    ];
    render(<TaskDrawer task={finished} onClose={vi.fn()} onOpenChat={vi.fn()} />);

    const item = stepItem('Фото после уборки');
    expect(within(item).getByText('Фото: 2')).toBeInTheDocument();
    expect(item.querySelectorAll('img')).toHaveLength(1);
    expect(within(item).getByText('Фото недоступно')).toBeInTheDocument();
  });

  // The viewer stands over the drawer: Esc puts the viewer away and leaves
  // the drawer where it was.
  test('a video plays in the viewer over the drawer, and Esc closes the viewer only', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TaskDrawer task={finished} onClose={onClose} onOpenChat={vi.fn()} />);

    await user.click(
      within(stepItem('Видео после работы')).getByRole('button', {
        name: 'Открыть видео 1 из 1',
      }),
    );

    const video = await screen.findByLabelText('Видео 1 из 1');
    expect(video).toHaveAttribute('src', 'https://signed/fresh/video.mp4');
    expect(video).toHaveAttribute('controls');
    expect(screen.getByRole('dialog', { name: 'Видео после работы' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByLabelText('Видео 1 из 1')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
