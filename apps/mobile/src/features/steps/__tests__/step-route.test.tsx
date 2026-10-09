import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import StepRoute from '@/app/task/[id]/step/[stepId]';
import type { VideoSettings } from '@/features/host/schema';

import type { TaskStep } from '../schema';

/**
 * One step, opened from its task. While the steps load their shape stands in
 * for them; steps that could not load say why in her language; a step that is
 * not among them says so.
 */

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const STEP_ID = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';

/** What the steps query reports; each test sets the state it is about. */
const mockSteps: { isPending: boolean; error: Error | null; data: TaskStep[] | undefined } = {
  isPending: true,
  error: null,
  data: undefined,
};

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', isLoading: false }),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  }),
}));

/** The task the step belongs to; undefined unless a test makes it hers and under way. */
const mockTask: { data: { status: string; assignee_id: string } | undefined } = {
  data: undefined,
};

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ isPending: false, error: null, data: mockTask.data }),
}));

jest.mock('@/features/steps/use-steps', () => {
  const idle = () => ({
    isPending: false,
    isPaused: false,
    isSuccess: false,
    error: null,
    mutate: jest.fn(),
  });
  return {
    useTaskSteps: () => mockSteps,
    useOpenStep: idle,
    useCompleteStep: idle,
    useReopenStep: idle,
    useSkipStep: idle,
  };
});

jest.mock('@/features/media/use-media', () => ({
  mediaItemViews: () => [],
  useAttachMedia: () => ({ error: null, mutate: jest.fn() }),
  useRemoveMedia: () => ({ error: null, mutate: jest.fn() }),
  useRememberLocalMedia: () => jest.fn(),
  useLocalMedia: () => ({ data: {} }),
  useMediaUrls: () => ({ data: {} }),
  useTaskMedia: () => ({ data: [] }),
  useUploadingMediaIds: () => new Set<string>(),
}));

/** What the company says about video; null until it has been read. */
const mockVideo: { settings: VideoSettings | null } = { settings: null };

jest.mock('@/features/host/use-host', () => ({
  useGalleryAllowed: () => true,
  useVideoSettings: () => mockVideo.settings,
}));

jest.mock('@/features/media/capture', () => ({
  capturePhoto: jest.fn(),
  pickPhotoFromGallery: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSteps.isPending = true;
  mockSteps.error = null;
  mockSteps.data = undefined;
  mockTask.data = undefined;
  mockVideo.settings = null;
});

test('while the steps load, their shape stands in for them, said as loading', async () => {
  await render(<StepRoute />);

  const loading = screen.getByRole('progressbar', { name: 'Загружаем уборки…' });
  expect(loading.props.accessibilityState).toMatchObject({ busy: true });
});

test('steps that could not load say why in her words, the server’s small under it', async () => {
  // Arrange
  mockSteps.isPending = false;
  mockSteps.error = new Error('Network request failed');

  // Act
  await render(<StepRoute />);

  // Assert
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByText('Network request failed')).toBeTruthy();
});

test('a step that is not among the task’s says so', async () => {
  mockSteps.isPending = false;
  mockSteps.data = [];

  await render(<StepRoute />);

  expect(screen.getByText('Шаг не найден')).toBeTruthy();
});

test('a step that is there opens, read-only once the task is not hers to change', async () => {
  // Arrange
  mockSteps.isPending = false;
  mockSteps.data = [
    {
      id: STEP_ID,
      task_id: TASK_ID,
      sort_order: 1,
      type: 'confirmation',
      required: false,
      title: 'Финальная проверка',
      instructions: null,
      started_at: null,
      completed_at: null,
      completed_by: null,
      title_i18n: {},
      instructions_i18n: {},
      config: {},
      min_photos: null,
      max_photos: null,
      max_video_sec: null,
      payload: {},
      skipped_at: null,
      skip_reason: null,
      waived_at: null,
      waive_reason: null,
    },
  ];

  // Act
  await render(<StepRoute />);

  // Assert
  expect(screen.getByText('Финальная проверка')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

describe('a video step of her task under way', () => {
  const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  function videoStep(overrides: Partial<TaskStep> = {}): TaskStep {
    return {
      id: STEP_ID,
      task_id: TASK_ID,
      sort_order: 3,
      type: 'video',
      required: true,
      title: 'Видео',
      instructions: null,
      started_at: '2026-10-09T08:00:00+00:00',
      completed_at: null,
      completed_by: null,
      title_i18n: {},
      instructions_i18n: {},
      config: {},
      min_photos: null,
      max_photos: null,
      max_video_sec: null,
      payload: {},
      skipped_at: null,
      skip_reason: null,
      waived_at: null,
      waive_reason: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockSteps.isPending = false;
    mockTask.data = { status: 'in_progress', assignee_id: ME };
  });

  test('records on the app’s own screen, to the length the company and the step allow', async () => {
    // Arrange: the step asks for nothing of its own; the company allows 90 s.
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };

    // Act
    await render(<StepRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать видео' }));

    // Assert
    expect(screen.getByText('Запишите одно видео до 90 с')).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/task/[id]/step/[stepId]/record',
      params: { id: TASK_ID, stepId: STEP_ID },
    });
  });

  test('a step shorter than the company’s limit says its own', async () => {
    mockSteps.data = [videoStep({ max_video_sec: 45 })];
    mockVideo.settings = { video_max_sec: 120, video_bitrate_kbps: 2000, video_max_mb: 45 };

    await render(<StepRoute />);

    expect(screen.getByText('Запишите одно видео до 45 с')).toBeTruthy();
  });

  // The company has opened its gallery (the mock above says so): photos may
  // come from it, a video never does.
  test('offers no gallery, whatever the company allows for photos', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };

    await render(<StepRoute />);

    expect(screen.queryByRole('button', { name: /галере/ })).toBeNull();
  });

  test('without the company’s settings the camera waits and nothing opens', async () => {
    mockSteps.data = [videoStep()];

    await render(<StepRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать видео' }));

    expect(router.push).not.toHaveBeenCalled();
  });
});
