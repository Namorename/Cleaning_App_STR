import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet, type ViewStyle } from 'react-native';

import type { CapturedMedia } from '@/features/media/capture';
import {
  KEPT_URI,
  RECORDED_URI,
  RecordRoute,
  STEP_ID,
  TASK_ID,
  deferred,
  discardFile,
  keep,
  kept,
  mockAttach,
  mockHeader,
  mockLeaveGuard,
  mockNavigation,
  mockPlayer,
  mockPreview,
  mockRemember,
  pressInAlert,
  recordFor,
  router,
  setUpRecordRoute,
} from '@/testing/record-route';

/**
 * The recording screen of a video step once a recording is in: the preview,
 * «Отправить» handing it to the upload queue, a send that did not go through,
 * and leaving with a recording not sent (docs/tech-plan.md §7.1).
 */

setUpRecordRoute();

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
