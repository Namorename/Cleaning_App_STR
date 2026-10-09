import { act, fireEvent, screen } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { AppState, type AlertButton, type AppStateStatus } from 'react-native';

import RecordRoute from '@/app/task/[id]/step/[stepId]/record';
import type { VideoSettings } from '@/features/host/schema';
import { keepRecording, type CapturedMedia } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { TaskMedia } from '@/features/media/schema';
import { TUS_SHORT_STALL_MS } from '@/features/media/tus';
import type { TaskStep } from '@/features/steps/schema';

/**
 * The stage of the recording screen's tests (`features/video/__tests__/record-*`):
 * the app's own camera, held to the company's numbers (docs/tech-plan.md §7.1).
 * The camera is a stand-in with the two methods the screen calls; the
 * permission hooks keep their state the way expo-camera's do, so a question
 * answered redraws the screen.
 *
 * The modules the screen talks to are replaced here, and the screen and the
 * stand-ins are handed out from here too: a test file imports them from this
 * module only, so nothing it uses is loaded before its replacement is in place.
 * Each file calls `setUpRecordRoute()` once, at its top.
 */

export { RecordRoute, discardFile, router, activateKeepAwakeAsync, deactivateKeepAwake };

/** The short limit: what the screen reads before the camera is not waited on longer. */
export const SHORT_LIMIT_MS = TUS_SHORT_STALL_MS;

export const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
export const STEP_ID = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';
export const RECORDED_URI = 'file:///cache/Camera/recording.mp4';
export const KEPT_URI = 'file:///documents/task-media/kept-id.mp4';
export const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

type Permission = {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
  expires: 'never';
};

export const GRANTED: Permission = {
  granted: true,
  status: 'granted',
  canAskAgain: true,
  expires: 'never',
};
export const NEVER_ASKED: Permission = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
  expires: 'never',
};
export const REFUSED: Permission = {
  granted: false,
  status: 'denied',
  canAskAgain: true,
  expires: 'never',
};
export const REFUSED_FOR_GOOD: Permission = { ...REFUSED, canAskAgain: false };

/** What the phone has granted, and what it answers when asked. */
export const mockPermissions: {
  camera: Permission;
  microphone: Permission;
  answers: { camera: Permission; microphone: Permission };
  asked: string[];
} = {
  camera: GRANTED,
  microphone: GRANTED,
  answers: { camera: GRANTED, microphone: GRANTED },
  asked: [],
};

/** The camera on screen: the props it was given and the two methods the screen calls. */
export const mockCamera: {
  props: Record<string, unknown>;
  recordAsync: jest.Mock;
  stopRecording: jest.Mock;
  finish: ((value: { uri: string } | undefined) => void) | null;
  fail: ((error: Error) => void) | null;
} = {
  props: {},
  recordAsync: jest.fn(),
  stopRecording: jest.fn(),
  finish: null,
  fail: null,
};

/** The navigation around the screen: who listens for her leaving, and what was dispatched. */
type NavigationListener = (event: unknown) => void;
export const mockNavigation = {
  listeners: new Map<string, Set<NavigationListener>>(),
  addListener: jest.fn((event: string, listener: NavigationListener) => {
    const listeners = mockNavigation.listeners.get(event) ?? new Set<NavigationListener>();
    listeners.add(listener);
    mockNavigation.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }),
  dispatch: jest.fn(),
};

/** Tell the screen she is leaving it, or another screen covered it. */
export async function navigationEvent(event: 'beforeRemove' | 'blur'): Promise<void> {
  await act(async () => {
    mockNavigation.listeners.get(event)?.forEach((listener) => listener({ data: {} }));
  });
}

/** The title the screen gave its header last. */
export const mockHeader: { title: unknown } = { title: undefined };

/** The guard against leaving: whether it is on, and what it does when she tries. */
export const mockLeaveGuard: {
  isOn: boolean;
  onPrevented: ((options: { data: { action: unknown } }) => void) | null;
} = { isOn: false, onPrevented: null };

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (
    isOn: boolean,
    onPrevented: (options: { data: { action: unknown } }) => void,
  ) => {
    mockLeaveGuard.isOn = isOn;
    mockLeaveGuard.onPrevented = onPrevented;
  },
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', isLoading: false }),
}));

/** The task the step belongs to: hers and under way unless a test says otherwise. */
export const mockTask: {
  isPending: boolean;
  data: { status: string; assignee_id: string | null } | undefined;
  refetch: jest.Mock;
} = { isPending: false, data: undefined, refetch: jest.fn() };

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({
    isPending: mockTask.isPending,
    error: null,
    data: mockTask.data,
    refetch: mockTask.refetch,
  }),
}));

/** The task's media as the step's screen reads them: read, unless a test says otherwise. */
export const mockMedia: {
  isPending: boolean;
  error: Error | null;
  data: TaskMedia[] | undefined;
  refetch: jest.Mock;
} = { isPending: false, error: null, data: [], refetch: jest.fn() };

/** The media the upload queue is sending right now, by id. */
export const mockUploading: { ids: Set<string> } = { ids: new Set() };

jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  function permissionHook(kind: 'camera' | 'microphone') {
    return () => {
      const [status, setStatus] = React.useState(mockPermissions[kind]);
      const request = React.useCallback(async () => {
        mockPermissions.asked.push(kind);
        const answer = mockPermissions.answers[kind];
        mockPermissions[kind] = answer;
        setStatus(answer);
        return answer;
      }, []);
      const get = React.useCallback(async () => {
        setStatus(mockPermissions[kind]);
        return mockPermissions[kind];
      }, []);
      return [status, request, get];
    };
  }

  function CameraView({
    ref,
    ...props
  }: {
    ref?: React.Ref<unknown>;
    onCameraReady?: () => void;
  } & Record<string, unknown>) {
    mockCamera.props = props;
    React.useImperativeHandle(ref, () => ({
      recordAsync: mockCamera.recordAsync,
      stopRecording: mockCamera.stopRecording,
    }));
    const { onCameraReady } = props;
    React.useEffect(() => {
      onCameraReady?.();
    }, [onCameraReady]);
    return React.createElement(View, { testID: 'camera-preview' });
  }

  return {
    CameraView,
    useCameraPermissions: permissionHook('camera'),
    useMicrophonePermissions: permissionHook('microphone'),
  };
});

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { title?: unknown } }) => {
      mockHeader.title = options?.title;
      return null;
    },
  },
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  }),
  useNavigation: () => mockNavigation,
}));

export const mockSteps: {
  isPending: boolean;
  error: Error | null;
  data: TaskStep[] | undefined;
  refetch: jest.Mock;
} = {
  isPending: false,
  error: null,
  data: undefined,
  refetch: jest.fn(),
};

jest.mock('@/features/steps/use-steps', () => ({ useTaskSteps: () => mockSteps }));

export const mockVideo: { settings: VideoSettings | null } = { settings: null };

jest.mock('@/features/host/use-host', () => ({ useVideoSettings: () => mockVideo.settings }));

export const mockAttach = jest.fn();
export const mockRemember = jest.fn(async () => undefined);

jest.mock('@/features/media/use-media', () => ({
  useAttachMedia: () => ({ mutate: mockAttach }),
  useRememberLocalMedia: () => mockRemember,
  useTaskMedia: () => mockMedia,
  useUploadingMediaIds: () => mockUploading.ids,
}));

jest.mock('@/features/media/capture', () => ({ keepRecording: jest.fn() }));

/** The size of the file the camera handed over, in bytes: small unless a test says. */
export const mockFile: { size: number } = { size: 0 };

jest.mock('@/features/media/file', () => ({
  discardFile: jest.fn(),
  fileSize: jest.fn(async () => mockFile.size),
}));

/** The player of the preview: what it was given, and whether it was started. */
export const mockPlayer = { loop: true, play: jest.fn(), pause: jest.fn() };
export const mockPreview: { source: unknown; props: Record<string, unknown> } = {
  source: null,
  props: {},
};

jest.mock('expo-video', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (player: typeof mockPlayer) => void) => {
      mockPreview.source = source;
      setup?.(mockPlayer);
      return mockPlayer;
    },
    VideoView: (props: Record<string, unknown>) => {
      mockPreview.props = props;
      return React.createElement(View, { testID: 'video-preview' });
    },
  };
});

// The screen's own lock against sleep, at the test boundary.
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

/** Free space on the phone, in bytes; null where the phone cannot say. */
export const mockDisk: { free: number | null } = { free: null };

jest.mock('@/features/video/disk-space', () => ({ freeDiskBytes: () => mockDisk.free }));

/** Every AppState listener the screen subscribed, to tell it the app went away. */
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

/** How many AppState listeners the screen holds right now. */
export function appStateListenerCount(): number {
  return appStateListeners.length;
}

export async function moveApp(state: AppStateStatus): Promise<void> {
  await act(async () => {
    appStateListeners.forEach((listener) => listener(state));
  });
}

export const keep = jest.mocked(keepRecording);

export function videoStep(overrides: Partial<TaskStep> = {}): TaskStep {
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

/** A video of the step as the server lists it. */
export function stepVideo(overrides: Partial<TaskMedia> = {}): TaskMedia {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    task_id: TASK_ID,
    step_id: STEP_ID,
    problem_id: null,
    kind: 'video',
    storage_path: `${TASK_ID}/a1b2c3d4-0000-4000-8000-000000000001.mp4`,
    mime_type: 'video/mp4',
    duration_sec: 12.3,
    device_taken_at: '2026-10-09T08:01:00+00:00',
    created_at: '2026-10-09T08:01:00+00:00',
    uploaded_at: null,
    deleted_at: null,
    ...overrides,
  };
}

/** The file kept from a recording, as `keepRecording` answers for it. */
export function kept(durationSec: number): CapturedMedia {
  return {
    id: 'kept-id',
    kind: 'video',
    uri: KEPT_URI,
    mimeType: 'video/mp4',
    byteSize: 21_000_000,
    width: null,
    height: null,
    durationSec,
    takenAt: '2026-10-09T08:00:00.000Z',
    source: 'camera',
  };
}

/** A promise and the hand that settles it, for a step that takes its time. */
export function deferred<T>() {
  let settle: { resolve: (value: T) => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

/**
 * The clock is drawn for the eye and hidden from screen readers, which hear
 * the words under it instead; queries have to be told to look at it.
 */
export const HIDDEN_TOO = { includeHiddenElements: true };

/** Let the clock run while the screen is drawn. */
export async function wait(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Start a recording, let it run, and stop it with «Стоп». */
export async function recordFor(ms: number): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
  await wait(ms);
  await fireEvent.press(screen.getByRole('button', { name: 'Стоп' }));
}

/** The buttons of the question asked last, and a press on one of them by its word. */
export function pressInAlert(alert: jest.SpyInstance, word: string): void {
  const buttons = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((item) => item.text === word);
  if (button === undefined) {
    throw new Error(`No «${word}» in the question`);
  }
  button.onPress?.();
}

/** The phone, the step and the camera as every test starts with them. */
function resetStage(): void {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-09T08:00:00.000Z') });
  mockPermissions.camera = GRANTED;
  mockPermissions.microphone = GRANTED;
  mockPermissions.answers = { camera: GRANTED, microphone: GRANTED };
  mockPermissions.asked = [];
  mockSteps.isPending = false;
  mockSteps.error = null;
  mockSteps.data = [videoStep()];
  mockVideo.settings = { video_max_sec: 90, video_bitrate_kbps: 2000, video_max_mb: 45 };
  mockCamera.finish = null;
  mockCamera.fail = null;
  // A recording runs until it is stopped: stopping is what hands the file over.
  mockCamera.recordAsync.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        mockCamera.finish = resolve;
        mockCamera.fail = reject;
      }),
  );
  mockNavigation.listeners.clear();
  mockHeader.title = undefined;
  mockLeaveGuard.isOn = false;
  mockLeaveGuard.onPrevented = null;
  mockTask.isPending = false;
  mockTask.data = { status: 'in_progress', assignee_id: ME };
  mockMedia.isPending = false;
  mockMedia.error = null;
  mockMedia.data = [];
  mockUploading.ids = new Set();
  // A minute of 720p is some 15 MB: far from the camera's 43.65 MB.
  mockFile.size = 2_500_000;
  mockCamera.stopRecording.mockImplementation(() => mockCamera.finish?.({ uri: RECORDED_URI }));
  keep.mockImplementation(async ({ durationSec }) => kept(durationSec));
  mockPlayer.loop = true;
  mockPreview.source = null;
  mockPreview.props = {};
  // The phone keeps the screen on, and lets it go, as soon as it is asked.
  jest.mocked(activateKeepAwakeAsync).mockImplementation(async () => undefined);
  jest.mocked(deactivateKeepAwake).mockImplementation(async () => undefined);
  // Plenty of room: 10 GB.
  mockDisk.free = 10_000_000_000;
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((item) => item !== listener);
      },
    };
  });
}

/** Each test of the file starts on a fresh stage, with the clock in the test's hands. */
export function setUpRecordRoute(): void {
  beforeEach(resetStage);
  afterEach(() => {
    jest.useRealTimers();
  });
}
