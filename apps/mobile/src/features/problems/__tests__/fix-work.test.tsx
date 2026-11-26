import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { FixWork, attemptsInOrder } from '../fix-work';

/**
 * «Работа техника» on a task's screen for the office (2026-11-26, «Sofa/gauč»): the technician's
 * steps with the photos he took on them, opened in the viewer. His phone showed them as
 * «Загружено»; the manager's phone and the panel showed none of them once the job was done.
 */

const DONE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const NEVER_STARTED = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const TECH = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const PHOTO_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const NOTE_STEP = 'cccccccc-cccc-4ccc-8ccc-000000000002';

const step = (id: string, type: string, title: string, sortOrder: number) => ({
  id,
  task_id: DONE,
  sort_order: sortOrder,
  type,
  required: true,
  title,
  title_i18n: {},
  instructions: null,
  instructions_i18n: {},
  min_photos: null,
  max_photos: null,
  completed_at: '2026-11-26T12:26:30+00:00',
  skipped_at: null,
  waived_at: null,
  waive_reason: null,
});

const media = (id: string, path: string, uploadedAt: string | null) => ({
  id,
  task_id: DONE,
  step_id: PHOTO_STEP,
  problem_id: null,
  kind: 'photo',
  storage_path: path,
  mime_type: 'image/jpeg',
  duration_sec: null,
  device_taken_at: null,
  created_at: '2026-11-26T12:26:03+00:00',
  uploaded_at: uploadedAt,
  deleted_at: null,
});

const mockSteps: Record<string, { data: unknown[] | undefined; error: Error | null }> = {};
const mockMedia: Record<string, { data: unknown[] | undefined; error: Error | null }> = {};

jest.mock('@/features/steps/use-steps', () => ({
  useTaskSteps: (taskId: string) => mockSteps[taskId] ?? { data: [], error: null },
}));
jest.mock('@/features/media/use-media', () => ({
  useTaskMedia: (taskId: string) => mockMedia[taskId] ?? { data: [], error: null },
  useMediaUrls: (paths: readonly string[]) => ({
    data: Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`])),
  }),
}));
jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({
    data: [{ id: TECH, full_name: 'Danylo Test', role: 'tech', is_active: true }],
    error: null,
  }),
}));
// The viewer has its own tests (photo-viewer); here it only says which file it was opened on.
jest.mock('@/features/media/photo-viewer-host', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PhotoViewerHost: ({ openId, total }: { openId: string; total: number }) => (
      <Text>{`viewer on ${openId} of ${total}`}</Text>
    ),
  };
});

beforeEach(() => {
  for (const key of Object.keys(mockSteps)) delete mockSteps[key];
  for (const key of Object.keys(mockMedia)) delete mockMedia[key];
  mockSteps[DONE] = {
    data: [
      step(PHOTO_STEP, 'photos_before', 'Фото проблемы', 1),
      step(NOTE_STEP, 'cleaner_comment', 'Что было сделано?', 2),
    ],
    error: null,
  };
  mockMedia[DONE] = {
    data: [
      media('dddddddd-dddd-4ddd-8ddd-000000000001', 'h/t/1.jpg', '2026-11-26T12:26:04+00:00'),
      media('dddddddd-dddd-4ddd-8ddd-000000000002', 'h/t/2.jpg', '2026-11-26T12:26:07+00:00'),
      // Still on its way from his phone: not evidence yet.
      media('dddddddd-dddd-4ddd-8ddd-000000000003', 'h/t/3.jpg', null),
    ],
    error: null,
  };
});

describe('«Работа техника» on the task’s screen', () => {
  test('a done repair shows its steps, who did it and the photos he uploaded', async () => {
    await render(<FixWork fixTasks={[{ id: DONE, assignee_id: TECH, status: 'done' }]} />);

    const block = within(screen.getByTestId('fix-work'));
    expect(block.getByText('Работа техника')).toBeOnTheScreen();
    expect(block.getByText('Danylo Test · Выполнена')).toBeOnTheScreen();
    expect(block.getByText('1. Фото проблемы')).toBeOnTheScreen();
    expect(block.getByText('2. Что было сделано?')).toBeOnTheScreen();
    expect(block.getByRole('button', { name: 'Открыть фото 1 из 2' })).toBeOnTheScreen();
    expect(block.getByRole('button', { name: 'Открыть фото 2 из 2' })).toBeOnTheScreen();
    expect(block.queryByRole('button', { name: /из 3/ })).toBeNull();
  });

  test('a photo opens in the viewer', async () => {
    await render(<FixWork fixTasks={[{ id: DONE, assignee_id: TECH, status: 'done' }]} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Открыть фото 2 из 2' }));

    expect(
      screen.getByText('viewer on dddddddd-dddd-4ddd-8ddd-000000000002 of 2'),
    ).toBeOnTheScreen();
  });

  test('an attempt that never started draws nothing', async () => {
    await render(
      <FixWork fixTasks={[{ id: NEVER_STARTED, assignee_id: TECH, status: 'cancelled' }]} />,
    );

    expect(screen.queryByTestId('fix-work')).toBeNull();
  });

  test('steps that could not be read say so instead of vanishing', async () => {
    mockSteps[DONE] = { data: undefined, error: new Error('Network request failed') };

    await render(<FixWork fixTasks={[{ id: DONE, assignee_id: TECH, status: 'done' }]} />);

    const block = within(screen.getByTestId('fix-work'));
    expect(block.getByText('Не удалось обновить, показаны сохранённые данные.')).toBeOnTheScreen();
    expect(block.getByText('Network request failed')).toBeOnTheScreen();
  });

  test('the live attempt comes first, those that are over after it', () => {
    expect(
      attemptsInOrder([
        { id: 'a', assignee_id: null, status: 'done' },
        { id: 'b', assignee_id: null, status: 'assigned' },
        { id: 'c', assignee_id: null, status: 'expired' },
      ]).map((attempt) => attempt.id),
    ).toEqual(['b', 'a', 'c']);
  });
});
