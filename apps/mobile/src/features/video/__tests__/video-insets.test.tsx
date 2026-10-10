import { render, screen } from '@testing-library/react-native';

import { Spacing } from '@/constants/theme';
import type { VideoLimits } from '@/features/media/schema';
import { BOTTOM_INSETS, scrollEndPadding, withBottomInset } from '@/testing/insets';

import { PermissionScreen } from '../permission-screen';
import type { VideoRecording } from '../use-video-recording';
import { VideoPreview } from '../video-preview';
import { VideoRecorder } from '../video-recorder';

/**
 * Block 3 (2026-10-10): on Android the three-button navigation bar lay over
 * the bottom of the screens. The recording screen's three faces — the camera
 * with «Записать», the preview with «Отправить» and «Переснять», the question
 * for the camera and the microphone — each end in their buttons at the bottom
 * edge, and each stops clear of the system's bar. What they draw is covered by
 * record-*.test.tsx; here only where their bottom edge is.
 */

// The camera and the player are native; neither draws anything here.
jest.mock('expo-camera', () => ({ CameraView: () => null }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false }),
  VideoView: () => null,
}));

/** A camera ready to record: what the recorder draws before «Записать». */
const mockReady: VideoRecording = {
  cameraKey: 0,
  isReady: true,
  onCameraReady: jest.fn(),
  onMountError: jest.fn(),
  isRecording: false,
  isSaving: false,
  elapsedMs: 0,
  trouble: null,
  failure: null,
  record: jest.fn(async () => {}),
  stop: jest.fn(),
  retry: jest.fn(),
};
jest.mock('../use-video-recording', () => ({ useVideoRecording: () => mockReady }));

const LIMITS: VideoLimits = {
  seconds: 30,
  maxBytes: 45_000_000,
  cameraMaxBytes: 43_650_000,
  bitrate: 2_000_000,
};

const RECORDING = {
  uri: 'file:///cache/Camera/recording.mp4',
  durationSec: 12,
  takenAt: '2026-10-10T08:00:00.000Z',
};

describe.each(BOTTOM_INSETS)('with a bottom inset of %i dp', (bottom) => {
  test('the camera’s «Записать» stands clear of the system’s bar', async () => {
    await render(withBottomInset(bottom, <VideoRecorder limits={LIMITS} onRecorded={jest.fn()} />));

    expect(screen.getByRole('button', { name: 'Записать' })).toBeTruthy();
    expect(scrollEndPadding()).toBe(Spacing.lg + bottom);
  });

  test('the preview’s «Переснять» stands clear of the system’s bar', async () => {
    await render(
      withBottomInset(
        bottom,
        <VideoPreview
          recording={RECORDING}
          uri={RECORDING.uri}
          end="stop"
          isSending={false}
          sendError={null}
          onRetake={jest.fn()}
          onSend={jest.fn()}
        />,
      ),
    );

    expect(screen.getByRole('button', { name: 'Переснять' })).toBeTruthy();
    expect(scrollEndPadding()).toBe(Spacing.lg + bottom);
  });

  test('the question’s «Открыть настройки» scrolls clear of the system’s bar', async () => {
    await render(
      withBottomInset(
        bottom,
        <PermissionScreen missing={['camera', 'microphone']} canAsk onAsk={jest.fn()} />,
      ),
    );

    expect(screen.getByRole('button', { name: 'Открыть настройки' })).toBeTruthy();
    expect(scrollEndPadding()).toBe(Spacing.xl + bottom);
  });
});
