import { render, screen } from '@testing-library/react-native';

import StepRoute from '@/app/task/[id]/step/[stepId]';

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

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ isPending: false, error: null, data: undefined }),
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

jest.mock('@/features/host/use-host', () => ({ useGalleryAllowed: () => false }));

jest.mock('@/features/media/capture', () => ({
  capturePhoto: jest.fn(),
  captureVideo: jest.fn(),
  pickPhotoFromGallery: jest.fn(),
  pickVideoFromGallery: jest.fn(),
}));

beforeEach(() => {
  mockSteps.isPending = true;
  mockSteps.error = null;
  mockSteps.data = undefined;
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
