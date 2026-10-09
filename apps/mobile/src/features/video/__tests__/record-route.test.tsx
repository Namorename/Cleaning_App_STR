import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo, Linking, StyleSheet, type ViewStyle } from 'react-native';

import RecordRoute from '@/app/task/[id]/step/[stepId]/record';
import type { VideoSettings } from '@/features/host/schema';
import { keepRecording, type CapturedMedia } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
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
} = {
  props: {},
  recordAsync: jest.fn(),
  stopRecording: jest.fn(),
  finish: null,
};

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
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  }),
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
}));

jest.mock('@/features/media/capture', () => ({ keepRecording: jest.fn() }));
jest.mock('@/features/media/file', () => ({ discardFile: jest.fn() }));

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
  // A recording runs until it is stopped: stopping is what hands the file over.
  mockCamera.recordAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        mockCamera.finish = resolve;
      }),
  );
  mockCamera.stopRecording.mockImplementation(() => mockCamera.finish?.({ uri: RECORDED_URI }));
  keep.mockImplementation(async ({ durationSec }) => kept(durationSec));
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
  test('«Записать» starts a recording held to the step’s length and the company’s size, in H.264', async () => {
    await render(<RecordRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    expect(mockCamera.recordAsync).toHaveBeenCalledWith({
      maxDuration: 90,
      maxFileSize: 45_000_000,
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

describe('the length of a recording', () => {
  test('«Стоп» hands the file to the upload queue with the length our timer measured', async () => {
    // Arrange
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await wait(12_345);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Стоп' }));

    // Assert
    expect(mockCamera.stopRecording).toHaveBeenCalled();
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

  // The camera stops at the limit itself; if it does not, the screen does, a
  // moment later. Either way the length declared is the limit, never more.
  test('a recording that reaches the limit is stopped and declared at the limit', async () => {
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await wait(91_000);

    expect(mockCamera.stopRecording).toHaveBeenCalled();
    expect(keep).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 90 }));
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
});
