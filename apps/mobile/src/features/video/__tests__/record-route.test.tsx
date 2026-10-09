import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Linking,
  StyleSheet,
  type AlertButton,
  type AppStateStatus,
  type ViewStyle,
} from 'react-native';

import RecordRoute from '@/app/task/[id]/step/[stepId]/record';
import type { VideoSettings } from '@/features/host/schema';
import { keepRecording, type CapturedMedia } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { TaskMedia } from '@/features/media/schema';
import type { TaskStep } from '@/features/steps/schema';

/**
 * The recording screen of a video step: the app's own camera, held to the
 * company's numbers (docs/tech-plan.md §7.1). The camera is a stand-in with
 * the two methods the screen calls; the permission hooks keep their state the
 * way expo-camera's do, so a question answered redraws the screen.
 */

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const STEP_ID = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';
const RECORDED_URI = 'file:///cache/Camera/recording.mp4';

type Permission = {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
  expires: 'never';
};

const GRANTED: Permission = {
  granted: true,
  status: 'granted',
  canAskAgain: true,
  expires: 'never',
};
const NEVER_ASKED: Permission = {
  granted: false,
  status: 'undetermined',
  canAskAgain: true,
  expires: 'never',
};
const REFUSED: Permission = {
  granted: false,
  status: 'denied',
  canAskAgain: true,
  expires: 'never',
};
const REFUSED_FOR_GOOD: Permission = { ...REFUSED, canAskAgain: false };

/** What the phone has granted, and what it answers when asked. */
const mockPermissions: {
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
const mockCamera: {
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
const mockNavigation = {
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
async function navigationEvent(event: 'beforeRemove' | 'blur'): Promise<void> {
  await act(async () => {
    mockNavigation.listeners.get(event)?.forEach((listener) => listener({ data: {} }));
  });
}

/** The title the screen gave its header last. */
const mockHeader: { title: unknown } = { title: undefined };

/** The guard against leaving: whether it is on, and what it does when she tries. */
const mockLeaveGuard: {
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

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', isLoading: false }),
}));

/** The task the step belongs to: hers and under way unless a test says otherwise. */
const mockTask: {
  isPending: boolean;
  data: { status: string; assignee_id: string | null } | undefined;
} = { isPending: false, data: undefined };

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ isPending: mockTask.isPending, error: null, data: mockTask.data }),
}));

/** The task's media as the step's screen reads them. */
const mockMedia: { data: TaskMedia[] | undefined } = { data: [] };

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

const mockSteps: { isPending: boolean; error: Error | null; data: TaskStep[] | undefined } = {
  isPending: false,
  error: null,
  data: undefined,
};

jest.mock('@/features/steps/use-steps', () => ({ useTaskSteps: () => mockSteps }));

const mockVideo: { settings: VideoSettings | null } = { settings: null };

jest.mock('@/features/host/use-host', () => ({ useVideoSettings: () => mockVideo.settings }));

const mockAttach = jest.fn();
const mockRemember = jest.fn(async () => undefined);

jest.mock('@/features/media/use-media', () => ({
  useAttachMedia: () => ({ mutate: mockAttach }),
  useRememberLocalMedia: () => mockRemember,
  useTaskMedia: () => mockMedia,
}));

jest.mock('@/features/media/capture', () => ({ keepRecording: jest.fn() }));

/** The size of the file the camera handed over, in bytes: small unless a test says. */
const mockFile: { size: number } = { size: 0 };

jest.mock('@/features/media/file', () => ({
  discardFile: jest.fn(),
  fileSize: jest.fn(async () => mockFile.size),
}));

/** The player of the preview: what it was given, and whether it was started. */
const mockPlayer = { loop: true, play: jest.fn(), pause: jest.fn() };
const mockPreview: { source: unknown; props: Record<string, unknown> } = {
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
const mockDisk: { free: number | null } = { free: null };

jest.mock('@/features/video/disk-space', () => ({ freeDiskBytes: () => mockDisk.free }));

/** Every AppState listener the screen subscribed, to tell it the app went away. */
let appStateListeners: ((state: AppStateStatus) => void)[] = [];

async function moveApp(state: AppStateStatus): Promise<void> {
  await act(async () => {
    appStateListeners.forEach((listener) => listener(state));
  });
}

const keep = jest.mocked(keepRecording);

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

/** The file kept from a recording, as `keepRecording` answers for it. */
function kept(durationSec: number): CapturedMedia {
  return {
    id: 'kept-id',
    kind: 'video',
    uri: 'file:///documents/task-media/kept-id.mp4',
    mimeType: 'video/mp4',
    byteSize: 21_000_000,
    width: null,
    height: null,
    durationSec,
    takenAt: '2026-10-09T08:00:00.000Z',
    source: 'camera',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-09T08:00:00.000Z') });
  mockPermissions.camera = GRANTED;
  mockPermissions.microphone = GRANTED;
  mockPermissions.answers = { camera: GRANTED, microphone: GRANTED };
  mockPermissions.asked = [];
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
  mockMedia.data = [];
  // A minute of 720p is some 15 MB: far from the camera's 43.65 MB.
  mockFile.size = 2_500_000;
  mockCamera.stopRecording.mockImplementation(() => mockCamera.finish?.({ uri: RECORDED_URI }));
  keep.mockImplementation(async ({ durationSec }) => kept(durationSec));
  mockPlayer.loop = true;
  mockPreview.source = null;
  mockPreview.props = {};
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
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The clock is drawn for the eye and hidden from screen readers, which hear
 * the words under it instead; queries have to be told to look at it.
 */
const HIDDEN_TOO = { includeHiddenElements: true };

/** Let the clock run while the screen is drawn. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('the camera', () => {
  test('records video in 720p from the back camera, at the company’s bitrate', async () => {
    await render(<RecordRoute />);

    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(mockCamera.props).toMatchObject({
      mode: 'video',
      videoQuality: '720p',
      videoBitrate: 2_000_000,
      facing: 'back',
    });
  });

  // On an iPhone the bitrate holds only with an explicit codec, and H.264 is
  // what plays in Chrome on the office's Windows (docs/tech-plan.md §7.1).
  // The camera stops 3 % short of the company's 45 MB: its container comes after.
  test('«Записать» starts a recording held to the step’s length and the company’s size, in H.264', async () => {
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(mockCamera.recordAsync).toHaveBeenCalledWith({
      maxDuration: 90,
      maxFileSize: 43_650_000,
      codec: 'avc1',
    });
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeTruthy();
  });

  test('the record button is a big round target with its word under it', async () => {
    await render(<RecordRoute />);

    const record = screen.getByRole('button', { name: 'Записать' });
    expect(screen.getByText('Записать')).toBeTruthy();
    expect(StyleSheet.flatten(record.props.style as ViewStyle)).toMatchObject({
      minWidth: 72,
      minHeight: 72,
    });
  });
});

describe('the countdown', () => {
  test('counts down from the limit, and tells the reader every ten seconds', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<RecordRoute />);
    expect(screen.getByText('1:30', HIDDEN_TOO)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(4_000);

    expect(screen.getByText('1:26', HIDDEN_TOO)).toBeTruthy();
    expect(screen.getByText('Осталось 90 секунд')).toBeTruthy();

    await wait(6_000);

    expect(screen.getByText('1:20', HIDDEN_TOO)).toBeTruthy();
    expect(screen.getByText('Осталось 80 секунд')).toBeTruthy();
    expect(announce).toHaveBeenLastCalledWith('Осталось 80 секунд');
  });

  test('the time left is a live region for screen readers', async () => {
    await render(<RecordRoute />);

    expect(screen.getByText('Осталось 90 секунд').props.accessibilityLiveRegion).toBe('polite');
    // The clock above it is for the eye: the reader is not handed it every second.
    expect(screen.queryByText('1:30')).toBeNull();
    expect(screen.getByText('1:30', HIDDEN_TOO)).toBeTruthy();
  });

  test('a step shorter than the company’s limit counts down from its own', async () => {
    mockSteps.data = [videoStep({ max_video_sec: 45 })];

    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(screen.getByText('0:45', HIDDEN_TOO)).toBeTruthy();
    expect(mockCamera.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({ maxDuration: 45 }),
    );
  });
});

/** Start a recording, let it run, and stop it with «Стоп». */
async function recordFor(ms: number): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
  await wait(ms);
  await fireEvent.press(screen.getByRole('button', { name: 'Стоп' }));
}

describe('the length of a recording', () => {
  test('«Стоп» shows the recording with the length our timer measured, and sends nothing yet', async () => {
    // Arrange
    await render(<RecordRoute />);

    // Act
    await recordFor(12_345);

    // Assert
    expect(mockCamera.stopRecording).toHaveBeenCalled();
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(screen.getByText('Видео · 12.3 с')).toBeTruthy();
    expect(keep).not.toHaveBeenCalled();
    expect(mockAttach).not.toHaveBeenCalled();
  });

  // The camera stops at the limit itself; if it does not, the screen does, a
  // moment later. Either way the length declared is the limit, never more.
  test('a recording that reaches the limit is stopped, said so, and declared at the limit', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await wait(91_000);

    expect(mockCamera.stopRecording).toHaveBeenCalled();
    expect(screen.getByText('Видео · 90 с')).toBeTruthy();
    expect(
      screen.getByText('Запись остановилась на пределе длины или размера файла.'),
    ).toBeTruthy();
  });

  test('one the camera ended itself at its size limit goes straight to the preview', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(30_000);

    // The camera reached maxFileSize and handed the file over without a «Стоп».
    mockFile.size = 43_500_000;
    await act(async () => {
      mockCamera.finish?.({ uri: RECORDED_URI });
    });

    expect(mockCamera.stopRecording).not.toHaveBeenCalled();
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(screen.getByText('Видео · 30 с')).toBeTruthy();
    expect(
      screen.getByText('Запись остановилась на пределе длины или размера файла.'),
    ).toBeTruthy();
  });

  test('one the camera ended itself within a second of the length limit was the limit', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(89_200);

    await act(async () => {
      mockCamera.finish?.({ uri: RECORDED_URI });
    });

    expect(screen.getByText('Видео · 89.2 с')).toBeTruthy();
    expect(
      screen.getByText('Запись остановилась на пределе длины или размера файла.'),
    ).toBeTruthy();
  });

  // A call coming in, the system taking the camera: it ends by itself, far
  // from both limits, and the screen does not blame a limit for it.
  test('one the camera ended itself far from both limits is said plainly, not as a limit', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(30_000);

    await act(async () => {
      mockCamera.finish?.({ uri: RECORDED_URI });
    });

    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(screen.getByText('Запись остановилась. Посмотрите, что записалось.')).toBeTruthy();
    expect(
      screen.queryByText('Запись остановилась на пределе длины или размера файла.'),
    ).toBeNull();
  });

  test('leaving while recording stops the camera and keeps nothing', async () => {
    const { unmount } = await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await unmount();
    await act(async () => {
      mockCamera.finish?.({ uri: RECORDED_URI });
    });

    expect(mockCamera.stopRecording).toHaveBeenCalled();
    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(keep).not.toHaveBeenCalled();
    expect(mockAttach).not.toHaveBeenCalled();
  });

  // Stopped once the view is gone, the camera may answer with an error of its
  // own; stopped as she leaves, the view is still there to stop.
  test('leaving while recording stops the camera as she leaves, while its view is still there', async () => {
    const { unmount } = await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await navigationEvent('beforeRemove');

    expect(mockCamera.stopRecording).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    await unmount();
  });

  test('a camera that refuses a recording cut by her leaving is not a fault to report', async () => {
    // The camera answers a stop on leaving with an error of its own.
    mockCamera.stopRecording.mockImplementation(() =>
      mockCamera.fail?.(new Error('Camera unmounted during recording')),
    );
    const { unmount } = await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await navigationEvent('beforeRemove');
    await unmount();

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test('a screen opened over the camera stops the recording too', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await navigationEvent('blur');

    expect(mockCamera.stopRecording).toHaveBeenCalledTimes(1);
  });
});

// Between «Стоп» and the file the camera is still writing: nothing else is
// started, and a stop it did not hear is said again.
describe('a recording being saved', () => {
  test('«Записать» waits, greyed, until the camera has handed the file over', async () => {
    // Arrange: the camera takes its time.
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);

    // Act
    await recordFor(3_000);

    // Assert
    const button = screen.getByRole('button', { name: 'Записать' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(button);
    expect(mockCamera.recordAsync).toHaveBeenCalledTimes(1);
  });

  test('a stop the camera did not hear is said again', async () => {
    // Arrange: the first stop is lost, the second hands the file over.
    mockCamera.stopRecording
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => mockCamera.finish?.({ uri: RECORDED_URI }));
    await render(<RecordRoute />);
    await recordFor(5_000);
    expect(screen.queryByTestId('video-preview')).toBeNull();

    // Act
    await wait(2_500);

    // Assert
    expect(mockCamera.stopRecording).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    // The length is what she stopped at, not when the camera finally answered.
    expect(screen.getByText('Видео · 5 с')).toBeTruthy();
  });

  test('a camera that never hands the file over ends in a failure, not a frozen button', async () => {
    // Arrange
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await wait(10_000);

    // Assert
    expect(screen.getByText('Запись не удалась')).toBeTruthy();
    expect(Sentry.captureException).toHaveBeenCalled();

    // A file that turns up after all is not kept.
    await act(async () => {
      mockCamera.finish?.({ uri: RECORDED_URI });
    });
    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(screen.queryByTestId('video-preview')).toBeNull();
  });
});

describe('the preview before sending', () => {
  test('plays the recording with the player’s own controls, and does not start by itself', async () => {
    await render(<RecordRoute />);

    await recordFor(5_000);

    expect(mockPreview.source).toBe(RECORDED_URI);
    expect(mockPreview.props).toMatchObject({ nativeControls: true });
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(mockPlayer.loop).toBe(false);
  });

  test('«Отправить» hands the file and its measured length to the upload queue, then goes back', async () => {
    // Arrange
    await render(<RecordRoute />);
    await recordFor(12_345);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert
    expect(keep).toHaveBeenCalledWith({
      uri: RECORDED_URI,
      durationSec: 12.3,
      takenAt: '2026-10-09T08:00:00.000Z',
    });
    expect(mockRemember).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'kept-id', kind: 'video', durationSec: 12.3 }),
    );
    expect(mockAttach).toHaveBeenCalledWith({
      taskId: TASK_ID,
      stepId: STEP_ID,
      uri: 'file:///documents/task-media/kept-id.mp4',
      mediaId: 'kept-id',
      kind: 'video',
      mimeType: 'video/mp4',
      byteSize: 21_000_000,
      width: null,
      height: null,
      durationSec: 12.3,
      takenAt: '2026-10-09T08:00:00.000Z',
      source: 'camera',
    });
    expect(router.back).toHaveBeenCalled();
  });

  test('«Отправить» is the main button, 56 dp; «Переснять» the framed one under it', async () => {
    await render(<RecordRoute />);
    await recordFor(5_000);

    const send = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Отправить' }).props.style as ViewStyle,
    );
    const retake = StyleSheet.flatten(
      screen.getByRole('button', { name: 'Переснять' }).props.style as ViewStyle,
    );
    expect(send.minHeight).toBe(56);
    expect(retake.minHeight).toBe(56);
    expect(retake.borderWidth).toBe(2);
  });

  test('«Переснять» throws the recording away and opens the camera again', async () => {
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Переснять' }));

    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Записать' })).toBeTruthy();
    expect(keep).not.toHaveBeenCalled();
  });

  test('leaving the preview without sending deletes the file', async () => {
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);

    await unmount();

    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(mockAttach).not.toHaveBeenCalled();
  });

  test('a recording that could not be kept says so, and the preview stays', async () => {
    keep.mockRejectedValue(new Error('The capture at file:///x measured zero bytes'));
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('The capture at file:///x measured zero bytes')).toBeTruthy();
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(mockAttach).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  test('the header says the recording is being watched, and recording again on «Переснять»', async () => {
    await render(<RecordRoute />);
    expect(mockHeader.title).toBe('Запись видео');

    await recordFor(5_000);
    expect(mockHeader.title).toBe('Просмотр видео');

    await fireEvent.press(screen.getByRole('button', { name: 'Переснять' }));
    expect(mockHeader.title).toBe('Запись видео');
  });

  test('a sent recording, the screen left after it, deletes nothing', async () => {
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await unmount();

    expect(discardFile).not.toHaveBeenCalled();
  });
});

/** A promise and the hand that settles it, for a step that takes its time. */
function deferred<T>() {
  let settle: { resolve: (value: T) => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

const KEPT_URI = 'file:///documents/task-media/kept-id.mp4';

// The camera's file is moved under a name of ours before it is remembered:
// after that, the camera's path is empty, and the kept file is the video.
describe('«Отправить» that did not go through', () => {
  test('is tried again with the kept file, not the camera’s path it has left', async () => {
    // Arrange: the ledger on disk could not be written the first time.
    mockRemember.mockRejectedValueOnce(new Error('disk I/O error'));
    await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getByText('disk I/O error')).toBeTruthy();

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert
    expect(keep).toHaveBeenCalledTimes(1);
    expect(mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({ uri: KEPT_URI, mediaId: 'kept-id' }),
    );
    expect(router.back).toHaveBeenCalled();
  });

  test('left behind, it deletes the kept file', async () => {
    mockRemember.mockRejectedValueOnce(new Error('disk I/O error'));
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await unmount();

    expect(discardFile).toHaveBeenCalledWith(KEPT_URI);
  });

  test('recorded again instead, it deletes the kept file', async () => {
    mockRemember.mockRejectedValueOnce(new Error('disk I/O error'));
    await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Переснять' }));

    expect(discardFile).toHaveBeenCalledWith(KEPT_URI);
    expect(screen.getByRole('button', { name: 'Записать' })).toBeTruthy();
  });
});

describe('while the recording is being sent', () => {
  test('«Переснять» waits', async () => {
    const keeping = deferred<CapturedMedia>();
    keep.mockReturnValue(keeping.promise);
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(
      screen.getByRole('button', { name: 'Переснять' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await act(async () => keeping.resolve(kept(5)));
  });

  test('the screen gone meanwhile deletes nothing, and the video still reaches the queue', async () => {
    // Arrange
    const keeping = deferred<CapturedMedia>();
    keep.mockReturnValue(keeping.promise);
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Act
    await unmount();
    await act(async () => keeping.resolve(kept(5)));

    // Assert
    expect(discardFile).not.toHaveBeenCalled();
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ uri: KEPT_URI }));
    // Nothing more to leave: going back now would close the step's screen too.
    expect(router.back).not.toHaveBeenCalled();
  });

  test('a send that fails after the screen is gone deletes the kept file', async () => {
    const keeping = deferred<CapturedMedia>();
    keep.mockReturnValue(keeping.promise);
    mockRemember.mockRejectedValueOnce(new Error('disk I/O error'));
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await unmount();
    await act(async () => keeping.resolve(kept(5)));

    expect(discardFile).toHaveBeenCalledWith(KEPT_URI);
    expect(mockAttach).not.toHaveBeenCalled();
  });
});

/** The buttons of the question asked last, and a press on one of them by its word. */
function pressInAlert(alert: jest.SpyInstance, word: string): void {
  const buttons = (alert.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((item) => item.text === word);
  if (button === undefined) {
    throw new Error(`No «${word}» in the question`);
  }
  button.onPress?.();
}

// The back button and an iPhone's edge swipe both leave the screen; a
// recording watched but not sent is lost with it unless she meant that.
describe('leaving the preview with a recording not sent', () => {
  test('asks first: «Остаться» keeps her there, «Не сохранять» lets her go', async () => {
    // Arrange
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<RecordRoute />);
    await recordFor(5_000);
    expect(mockLeaveGuard.isOn).toBe(true);
    const back = { type: 'GO_BACK' };

    // Act
    await act(async () => mockLeaveGuard.onPrevented?.({ data: { action: back } }));

    // Assert
    expect(alert).toHaveBeenCalledWith(
      'Видео не отправлено',
      'Если уйти, запись удалится с телефона.',
      expect.any(Array),
      expect.anything(),
    );
    pressInAlert(alert, 'Остаться');
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    pressInAlert(alert, 'Не сохранять');
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(back);
    alert.mockRestore();
  });

  test('nothing is asked on the camera, nor once the recording is sent', async () => {
    await render(<RecordRoute />);
    expect(mockLeaveGuard.isOn).toBe(false);

    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(mockLeaveGuard.isOn).toBe(false);
  });
});

describe('room on the phone', () => {
  // The company's limit is 45 MB; a recording is not started without 54 MB free.
  test('too little free space says how much is needed, and nothing is recorded', async () => {
    mockDisk.free = 50_000_000;
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(screen.getByText('Мало места на телефоне')).toBeTruthy();
    expect(
      screen.getByText(
        'Для записи нужно не меньше 54 МБ свободного места, свободно 50 МБ. Освободите место и нажмите «Записать» снова.',
      ),
    ).toBeTruthy();
    expect(mockCamera.recordAsync).not.toHaveBeenCalled();
  });

  test('once there is room, the same button records', async () => {
    mockDisk.free = 50_000_000;
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    mockDisk.free = 60_000_000;
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(mockCamera.recordAsync).toHaveBeenCalled();
    expect(screen.queryByText('Мало места на телефоне')).toBeNull();
  });

  // A phone that cannot say how much room it has is not stopped on a guess:
  // the camera's own size limit still holds.
  test('a phone that cannot tell its free space records anyway', async () => {
    mockDisk.free = null;
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(mockCamera.recordAsync).toHaveBeenCalled();
  });
});

describe('the app put away while recording', () => {
  test('stops the recording and shows what was recorded, with why it stopped', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(5_000);

    await moveApp('background');

    expect(mockCamera.stopRecording).toHaveBeenCalled();
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(screen.getByText('Видео · 5 с')).toBeTruthy();
    expect(
      screen.getByText(
        'Запись остановилась, когда приложение свернули. Посмотрите, что записалось.',
      ),
    ).toBeTruthy();
  });

  test('a recording cut off in its first second is thrown away, and she is told', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(400);

    await moveApp('background');

    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(screen.queryByTestId('video-preview')).toBeNull();
    expect(
      screen.getByText(
        'Запись прервалась в первую же секунду: приложение свернули. Запишите снова.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Записать' })).toBeTruthy();
  });

  // The rule is «under a second»: a second exactly is kept, nine tenths are not.
  test('a recording cut off at a second exactly is kept', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(1_000);

    await moveApp('background');

    expect(discardFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('video-preview')).toBeTruthy();
    expect(screen.getByText('Видео · 1 с')).toBeTruthy();
  });

  test('a recording cut off at nine tenths of a second is not', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(900);

    await moveApp('background');

    expect(discardFile).toHaveBeenCalledWith(RECORDED_URI);
    expect(screen.queryByTestId('video-preview')).toBeNull();
  });

  test('the screen stops listening to the app once it is gone', async () => {
    const { unmount } = await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    expect(appStateListeners.length).toBeGreaterThan(0);

    await unmount();

    expect(appStateListeners).toEqual([]);
  });

  // A look at a notification pulls the app to «inactive», not away.
  test('a moment of «inactive» does not stop it', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await moveApp('inactive');

    expect(mockCamera.stopRecording).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeTruthy();
  });
});

describe('a camera that fails', () => {
  test('one that does not start says so in her words, the camera’s small under them, with a retry', async () => {
    // Arrange
    await render(<RecordRoute />);
    const { onMountError } = mockCamera.props as {
      onMountError: (event: { message: string }) => void;
    };

    // Act
    await act(async () => {
      onMountError({ message: 'Camera is in use by another app' });
    });

    // Assert
    expect(screen.getByText('Камера не включилась')).toBeTruthy();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Camera is in use by another app')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getByTestId('camera-preview')).toBeTruthy();
  });

  test('a recording that fails says so, and the camera comes back on «Повторить»', async () => {
    mockCamera.recordAsync.mockRejectedValue(new Error('Recording failed: no space'));
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(screen.getByText('Запись не удалась')).toBeTruthy();
    expect(screen.getByText('Recording failed: no space')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getByRole('button', { name: 'Записать' })).toBeTruthy();
  });

  test('a recording that came back without a file is a failure too, not a silent nothing', async () => {
    mockCamera.stopRecording.mockImplementation(() => mockCamera.finish?.(undefined));
    await render(<RecordRoute />);

    await recordFor(3_000);

    expect(screen.getByText('Запись не удалась')).toBeTruthy();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.queryByTestId('video-preview')).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  // Another app holding the camera is the commonest cause; the report says how often.
  test('a camera that does not start is reported, as a failed recording is', async () => {
    await render(<RecordRoute />);
    const { onMountError } = mockCamera.props as {
      onMountError: (event: { message: string }) => void;
    };

    await act(async () => {
      onMountError({ message: 'Camera is in use by another app' });
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Camera is in use by another app' }),
    );
  });

  test('a recording that fails is reported', async () => {
    const failure = new Error('Recording failed: no space');
    mockCamera.recordAsync.mockRejectedValue(failure);
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });
});

describe('the camera and the microphone', () => {
  test('the first time, the phone is asked for the camera, then for the microphone', async () => {
    mockPermissions.camera = NEVER_ASKED;
    mockPermissions.microphone = NEVER_ASKED;

    await render(<RecordRoute />);

    expect(await screen.findByTestId('camera-preview')).toBeTruthy();
    expect(mockPermissions.asked).toEqual(['camera', 'microphone']);
  });

  test('a camera refused once says so and offers to ask again or the settings', async () => {
    // Arrange
    mockPermissions.camera = REFUSED;

    // Act
    await render(<RecordRoute />);

    // Assert
    expect(screen.getByText('Нет доступа к камере')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Открыть настройки' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Разрешить доступ' }));

    expect(mockPermissions.asked).toContain('camera');
    expect(await screen.findByTestId('camera-preview')).toBeTruthy();
  });

  test('a microphone refused for good is named, and only the settings can help', async () => {
    // Arrange
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockPermissions.microphone = REFUSED_FOR_GOOD;

    // Act
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Открыть настройки' }));

    // Assert
    expect(screen.getByText('Нет доступа к микрофону')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Разрешить доступ' })).toBeNull();
    expect(openSettings).toHaveBeenCalled();
    expect(mockCamera.recordAsync).not.toHaveBeenCalled();
  });

  test('both refused are named together', async () => {
    mockPermissions.camera = REFUSED_FOR_GOOD;
    mockPermissions.microphone = REFUSED_FOR_GOOD;

    await render(<RecordRoute />);

    expect(screen.getByText('Нет доступа к камере и микрофону')).toBeTruthy();
  });

  // The camera refused at the first question, then allowed in the phone's
  // settings: the microphone behind it was never asked, and is asked now —
  // not waited for behind «Включаем камеру…».
  test('a camera allowed in the settings after a refusal brings the microphone’s question', async () => {
    // Arrange
    mockPermissions.camera = NEVER_ASKED;
    mockPermissions.microphone = NEVER_ASKED;
    mockPermissions.answers = { camera: REFUSED, microphone: GRANTED };
    await render(<RecordRoute />);
    expect(await screen.findByText('Нет доступа к камере')).toBeTruthy();

    // Act: she allows the camera in the settings and comes back.
    mockPermissions.camera = GRANTED;
    await moveApp('active');

    // Assert
    expect(await screen.findByTestId('camera-preview')).toBeTruthy();
    expect(mockPermissions.asked).toEqual(['camera', 'microphone']);
  });

  // A question put away without an answer leaves the permission unasked: the
  // screen says what is missing rather than waiting for an answer nobody gives.
  test('a microphone still unanswered after its question is named, and can be asked again', async () => {
    mockPermissions.microphone = NEVER_ASKED;
    mockPermissions.answers = { camera: GRANTED, microphone: NEVER_ASKED };

    await render(<RecordRoute />);

    expect(await screen.findByText('Нет доступа к микрофону')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Разрешить доступ' })).toBeTruthy();
    expect(mockPermissions.asked).toContain('microphone');
  });
});

// A phone locks itself after half a minute untouched; a recording of ninety
// seconds would be cut by its own screen going dark.
describe('the screen while recording', () => {
  test('stays awake from «Записать» to «Стоп», under one tag', async () => {
    // Arrange
    await render(<RecordRoute />);
    expect(activateKeepAwakeAsync).not.toHaveBeenCalled();

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    // Assert
    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    const [tag] = jest.mocked(activateKeepAwakeAsync).mock.calls[0];
    expect(tag).toEqual(expect.any(String));
    expect(deactivateKeepAwake).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Стоп' }));

    expect(deactivateKeepAwake).toHaveBeenCalledWith(tag);
  });

  test('may sleep again once she leaves in the middle of a recording', async () => {
    const { unmount } = await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    const [tag] = jest.mocked(activateKeepAwakeAsync).mock.calls[0];

    await unmount();

    expect(deactivateKeepAwake).toHaveBeenCalledWith(tag);
  });

  test('may sleep again the moment the app is put away, before the file is in', async () => {
    // The camera takes its time to hand the file over.
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    const [tag] = jest.mocked(activateKeepAwakeAsync).mock.calls[0];

    await moveApp('background');

    expect(deactivateKeepAwake).toHaveBeenCalledWith(tag);
  });

  test('is not held awake before anything is recorded', async () => {
    const { unmount } = await render(<RecordRoute />);

    await unmount();

    expect(activateKeepAwakeAsync).not.toHaveBeenCalled();
  });
});

describe('what the screen needs before it records', () => {
  test('without the company’s settings it says why and shows no camera', async () => {
    mockVideo.settings = null;

    await render(<RecordRoute />);

    expect(
      screen.getByText('Настройки видео ещё не получены. Нужна связь — попробуйте позже.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  test('a step that is not a video step is not recorded into', async () => {
    mockSteps.data = [videoStep({ type: 'photos_after' })];

    await render(<RecordRoute />);

    expect(screen.getByText('Шаг не найден')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  // The same rules as the step's own button, for a screen reached some other
  // way — a link, a screen kept in the history: no camera for a recording the
  // server would refuse.
  test('a task not hers, or not under way, opens no camera and says why', async () => {
    mockTask.data = { status: 'completed', assignee_id: ME };

    await render(<RecordRoute />);

    expect(screen.getByText('Шаги можно менять, только пока уборка в работе')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  test('a step already done opens no camera and says so', async () => {
    mockSteps.data = [videoStep({ completed_at: '2026-10-09T08:05:00+00:00' })];

    await render(<RecordRoute />);

    expect(screen.getByText(/^Выполнен в /)).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  test('a step that has its video already opens no camera and says what to do', async () => {
    mockMedia.data = [stepVideo()];

    await render(<RecordRoute />);

    expect(
      screen.getByText('У шага уже есть видео. Чтобы записать новое, удалите его на экране шага.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  test('a video taken back does not hold the step', async () => {
    mockMedia.data = [stepVideo({ deleted_at: '2026-10-09T08:03:00+00:00' })];

    await render(<RecordRoute />);

    expect(screen.getByTestId('camera-preview')).toBeTruthy();
  });

  // The video she sends lands in the step's list before the screen is gone:
  // the camera, once open, is not swapped for a refusal under her.
  test('once open, the camera stays though the step’s video arrives meanwhile', async () => {
    await render(<RecordRoute />);
    await recordFor(5_000);

    mockMedia.data = [stepVideo()];
    await screen.rerender(<RecordRoute />);

    expect(screen.getByTestId('video-preview')).toBeTruthy();
  });
});

/** A video of the step as the server lists it. */
function stepVideo(overrides: Partial<TaskMedia> = {}): TaskMedia {
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
