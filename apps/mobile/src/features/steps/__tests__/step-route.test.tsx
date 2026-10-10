import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import StepRoute, { ErrorBoundary } from '@/app/task/[id]/step/[stepId]';
import { RouteError } from '@/components/route-error';
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
const mockSteps: {
  isPending: boolean;
  error: Error | null;
  data: TaskStep[] | undefined;
  refetch: jest.Mock;
} = {
  isPending: true,
  error: null,
  data: undefined,
  refetch: jest.fn(),
};

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', isLoading: false }),
}));

/** What the screen does when it is in front again; called by a test to bring it back. */
const mockFocus: { effect: (() => void) | null } = { effect: null };

/**
 * The screen's place in the stack: who listens for it leaving, and what it
 * set on the header. expo-router queues a back and runs it after the draw,
 * so `router.back` here tells no listener: `beforeRemove` comes late.
 */
type Listener = () => void;
const mockNavigation = {
  listeners: new Map<string, Set<Listener>>(),
  setOptions: jest.fn(),
  isFocused: () => true,
  addListener: jest.fn((event: string, listener: Listener) => {
    const listeners = mockNavigation.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    mockNavigation.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }),
};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn() },
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => ({
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  }),
  useFocusEffect: (effect: () => void) => {
    mockFocus.effect = effect;
  },
}));

/** The task the step belongs to; undefined unless a test makes it hers and under way. */
const mockTask: { data: { status: string; assignee_id: string } | undefined } = {
  data: undefined,
};

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ isPending: false, error: null, data: mockTask.data }),
}));

/** Whether the server has answered «Выполнено»; a test turns it on. */
const mockComplete = { isSuccess: false };

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
    useCompleteStep: () => ({ ...idle(), isSuccess: mockComplete.isSuccess }),
    useReopenStep: idle,
    useSkipStep: idle,
  };
});

/** A video the recording screen sent to this step and the server refused, if any. */
const mockVideoAttach: { error: unknown } = { error: null };

/** What the queue says of the uploads under way: paused for signal, and how far each has got. */
const mockTransfers = {
  waiting: new Set<string>(),
  progress: {} as Record<string, number>,
  failures: new Map<string, unknown>(),
};
const mockMediaItemViews = jest.fn((..._args: unknown[]): unknown[] => []);

/** The two queues the step hands files to: photos, and videos on their own. */
const mockAttach = {
  photo: { error: null, mutate: jest.fn() },
  video: { error: null, mutate: jest.fn() },
};

/** The captures the phone remembers, by media id. */
const mockLocal: { data: Record<string, unknown> } = { data: {} };
/** The task's media as the server lists them. */
const mockTaskMedia: { data: unknown[] } = { data: [] };
/** The paths the screen asked to have signed. */
const mockMediaUrls = jest.fn((_paths: readonly string[]) => ({ data: {} }));

jest.mock('@/features/media/use-media', () => ({
  mediaItemViews: (...args: unknown[]) => mockMediaItemViews(...args),
  useWaitingMediaIds: () => mockTransfers.waiting,
  useUploadProgress: () => mockTransfers.progress,
  useAttachFailures: () => mockTransfers.failures,
  useFailedVideoAttach: () => mockVideoAttach.error,
  useAttachMedia: (kind?: string) => (kind === 'video' ? mockAttach.video : mockAttach.photo),
  useRemoveMedia: () => ({ error: null, mutate: jest.fn() }),
  useRememberLocalMedia: () => jest.fn(),
  useLocalMedia: () => mockLocal,
  useMediaUrls: (paths: readonly string[]) => mockMediaUrls(paths),
  useTaskMedia: () => mockTaskMedia,
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
  mockVideoAttach.error = null;
  mockLocal.data = {};
  mockTaskMedia.data = [];
  mockMediaItemViews.mockImplementation(() => []);
  mockComplete.isSuccess = false;
  mockNavigation.listeners.clear();
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

// The two whole-branch reviews of phone-1-2-0, finding 4: steps that never
// loaded are a screen that failed; steps that did and only failed to refresh
// stay on screen — the step she is filling in with them — and the failure is
// said above.
describe('a read of the steps that fails', () => {
  const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const SCREEN_FAILED = 'Не удалось показать экран. Попробуйте ещё раз.';
  const REFRESH_FAILED = 'Не удалось обновить, показаны сохранённые данные.';

  const commentStep: TaskStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    sort_order: 2,
    type: 'cleaner_comment',
    required: true,
    title: 'Комментарий',
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
  };

  beforeEach(() => {
    mockSteps.isPending = false;
    mockTask.data = { status: 'in_progress', assignee_id: ME };
  });

  test('before the steps ever loaded, says the screen failed and offers to try again', async () => {
    // Arrange
    mockSteps.error = new Error('Network request failed');

    // Act
    await render(<StepRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert
    expect(screen.getByText(SCREEN_FAILED)).toBeTruthy();
    expect(mockSteps.refetch).toHaveBeenCalledTimes(1);
  });

  test('after they loaded, keeps the step and her unsent comment, the failure said above', async () => {
    // Arrange: she has started typing.
    mockSteps.data = [commentStep];
    await render(<StepRoute />);
    await fireEvent.changeText(screen.getByLabelText('Для менеджера'), 'Пятно на диване');

    // Act: a refresh of the steps fails; the saved ones are still there.
    mockSteps.error = new Error('Network request failed');
    await screen.rerender(<StepRoute />);

    // Assert
    expect(screen.getByText(REFRESH_FAILED)).toBeTruthy();
    expect(screen.getByDisplayValue('Пятно на диване')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy();
    expect(screen.queryByText(SCREEN_FAILED)).toBeNull();
  });
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

  // The video was handed to the queue from the recording screen, which has
  // gone by the time the server answers: the step says why it was refused.
  test('a video the server refused after she left the camera says why, in her words', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    mockVideoAttach.error = {
      message: 'Video must be recorded with the app camera',
      hint: 'serverErrors.videoCameraOnly',
      details: '{}',
    };

    await render(<StepRoute />);

    expect(screen.getByText('Видео снимают камерой приложения, не из галереи.')).toBeTruthy();
  });

  // The tile of a video on its way says how far it has got, or that it waits
  // for signal: the screen hands it what the queue knows.
  test('hands the tiles what the queue knows of each upload under way, and why the stranded failed', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    mockTransfers.waiting = new Set(['m1']);
    mockTransfers.progress = { m1: 0.5 };
    mockTransfers.failures = new Map([['m2', { key: 'tooLarge' }]]);

    await render(<StepRoute />);

    expect(mockMediaItemViews).toHaveBeenLastCalledWith([], {}, {}, expect.any(Set), {
      waiting: mockTransfers.waiting,
      progress: mockTransfers.progress,
      failures: mockTransfers.failures,
    });
  });

  // The camera's screen takes a moment to come up; a second tap meanwhile
  // would put a second camera on top of the first.
  test('a second tap before the camera is up opens nothing more', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    await render(<StepRoute />);
    const button = screen.getByRole('button', { name: 'Записать видео' });

    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  test('back on the step, the button opens the camera again', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    await render(<StepRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать видео' }));

    await act(async () => mockFocus.effect?.());
    await fireEvent.press(screen.getByRole('button', { name: 'Записать видео' }));

    expect(router.push).toHaveBeenCalledTimes(2);
  });

  // A video sent again from its tile goes to the videos' own queue, not
  // behind the step's photos — nor they behind it.
  test('a video tried again from its tile goes to the videos’ queue', async () => {
    // Arrange
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    mockLocal.data = {
      m1: {
        id: 'm1',
        kind: 'video',
        uri: 'file:///documents/task-media/m1.mp4',
        mimeType: 'video/mp4',
        byteSize: 21_000_000,
        width: null,
        height: null,
        durationSec: 12.3,
        takenAt: '2026-10-09T08:00:00.000Z',
        source: 'camera',
      },
    };
    mockMediaItemViews.mockImplementation(() => [
      { id: 'm1', kind: 'video', uri: null, status: 'failed', durationSec: 12.3 },
    ]);
    await render(<StepRoute />);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку. Видео' }));

    // Assert
    expect(mockAttach.video.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'm1', kind: 'video', stepId: STEP_ID }),
    );
    expect(mockAttach.photo.mutate).not.toHaveBeenCalled();
  });

  // A confirmed video draws no picture on its tile: a signed link for it is
  // a request for nothing. A photo no longer on the phone still needs one.
  test('asks for signed links of photos only', async () => {
    mockSteps.data = [videoStep()];
    mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
    const row = (id: string, kind: 'photo' | 'video', path: string) => ({
      id,
      task_id: TASK_ID,
      step_id: STEP_ID,
      problem_id: null,
      kind,
      storage_path: path,
      mime_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
      duration_sec: kind === 'video' ? 12.3 : null,
      device_taken_at: '2026-10-09T08:01:00+00:00',
      created_at: '2026-10-09T08:01:00+00:00',
      uploaded_at: '2026-10-09T08:02:00+00:00',
      deleted_at: null,
    });
    mockTaskMedia.data = [
      row('v1', 'video', 'host/task/v1.mp4'),
      row('p1', 'photo', 'host/task/p1.jpg'),
    ];

    await render(<StepRoute />);

    expect(mockMediaUrls).toHaveBeenLastCalledWith(['host/task/p1.jpg']);
  });

  test('without the company’s settings the camera waits and nothing opens', async () => {
    mockSteps.data = [videoStep()];

    await render(<StepRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать видео' }));

    expect(router.push).not.toHaveBeenCalled();
  });
});

// «Выполнено» takes her back by itself, and the answers that come in during
// the way back redraw the screen. On Android a header touched in the pop's
// moment brings the app down (Sentry, 2026-10-09 and 10-10), so the title is
// set once, and not again from the draw that decides to leave — before the
// queued back has told anyone.
describe('the header of a step that leaves by itself', () => {
  const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const step: TaskStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    sort_order: 2,
    type: 'cleaner_comment',
    required: true,
    title: 'Комментарий',
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
  };

  beforeEach(() => {
    mockSteps.isPending = false;
    mockSteps.data = [step];
    mockTask.data = { status: 'in_progress', assignee_id: ME };
  });

  test('is set once, not on every redraw', async () => {
    const { rerender } = await render(<StepRoute />);
    await rerender(<StepRoute />);
    await rerender(<StepRoute />);

    expect(mockNavigation.setOptions).toHaveBeenCalledTimes(1);
    expect(mockNavigation.setOptions).toHaveBeenCalledWith({ title: 'Комментарий' });
  });

  test('done, back first: the redraws of the way back leave it alone', async () => {
    // Arrange
    const { rerender } = await render(<StepRoute />);
    mockNavigation.setOptions.mockClear();

    // Act: the server answers, the screen goes back, the steps come in again.
    mockComplete.isSuccess = true;
    await rerender(<StepRoute />);
    expect(router.back).toHaveBeenCalledTimes(1);
    mockSteps.data = [
      { ...step, title: 'Комментарий горничной', completed_at: '2026-10-09T08:05:00+00:00' },
    ];
    await rerender(<StepRoute />);

    // Assert
    expect(mockNavigation.setOptions).not.toHaveBeenCalled();
  });
});

// Night of 2026-10-10, block 1: a step that fails to draw says so with
// «Повторить» and «Назад», rather than leaving the root to catch it.
test('the step has a boundary of its own', () => {
  expect(ErrorBoundary).toBe(RouteError);
});
