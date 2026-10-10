import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet, type ViewStyle } from 'react-native';

import type { CapturedMedia } from '@/features/media/capture';
import { mediaFileUri } from '@/features/media/media-path';
import {
  KEPT_URI,
  RECORDED_URI,
  RecordErrorBoundary,
  RecordRoute,
  RouteError,
  STEP_ID,
  TASK_ID,
  deferred,
  discardFile,
  keep,
  kept,
  mockAttach,
  mockHeader,
  mockLeaveGuard,
  mockMedia,
  mockNavigation,
  mockPlayer,
  mockPreview,
  mockRemember,
  mockUploading,
  pressInAlert,
  recordFor,
  router,
  setUpRecordRoute,
  stepVideo,
  wait,
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
      // The queue is handed its place in the documents (iPhone risk 1).
      uri: 'task-media/kept-id.mp4',
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

  test('its own header says the recording is being watched, and recording again on «Переснять»', async () => {
    await render(<RecordRoute />);
    expect(screen.getByRole('header', { name: 'Запись видео' })).toBeTruthy();

    await recordFor(5_000);
    expect(screen.getByRole('header', { name: 'Просмотр видео' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Переснять' }));
    expect(screen.getByRole('header', { name: 'Запись видео' })).toBeTruthy();
    // The system's header is never touched (Sentry, 2026-10-09 and 10-10).
    expect(mockHeader.title).toBeUndefined();
    expect(mockNavigation.setOptions).not.toHaveBeenCalled();
  });

  test('a sent recording, the screen left after it, deletes nothing', async () => {
    const { unmount } = await render(<RecordRoute />);
    await recordFor(5_000);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    await unmount();

    expect(discardFile).not.toHaveBeenCalled();
  });
});

describe('a recording larger than the storage takes', () => {
  test('is refused before the queue, says why in her language, and «Переснять» stays', async () => {
    // Arrange: the company allows 140 MB, the storage on its plan takes 50.
    keep.mockImplementation(async ({ durationSec }) => ({
      ...kept(durationSec),
      byteSize: 105_900_000,
    }));
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert
    expect(
      screen.getByText(
        'Видео весит 106 МБ, а хранилище принимает файлы не больше 50 МБ. Нажмите «Переснять» и запишите видео короче.',
      ),
    ).toBeTruthy();
    expect(mockRemember).not.toHaveBeenCalled();
    expect(mockAttach).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Переснять' })).toBeTruthy();
  });

  // A refusal she can act on is not a crash: each press would otherwise send
  // the same event again.
  test('is not reported as a crash', async () => {
    keep.mockImplementation(async ({ durationSec }) => ({
      ...kept(durationSec),
      byteSize: 105_900_000,
    }));
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(discardFile).not.toHaveBeenCalled();
  });

  test('a file right at the storage limit goes to the queue', async () => {
    keep.mockImplementation(async ({ durationSec }) => ({
      ...kept(durationSec),
      byteSize: 50_000_000,
    }));
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ byteSize: 50_000_000 }));
    expect(router.back).toHaveBeenCalled();
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

// Night of 2026-10-10, block 1: after «Отправить» the owner's phone showed an
// empty screen and stayed there, for a cleaner and for the head technician
// alike. The send now lets go of the player before the file moves, never
// leaves the screen without a way out, and marks each link of the hand-over
// for the crash report that follows a failure.
describe('the hand-over, made sure', () => {
  test('the player is let go while the recording is handed over, and comes back if it fails', async () => {
    // Arrange
    const keeping = deferred<CapturedMedia>();
    keep.mockReturnValue(keeping.promise);
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert: no player over a file on its way to another folder.
    expect(screen.queryByTestId('video-preview')).toBeNull();
    expect(screen.getByText('Готовим видео к отправке…')).toBeTruthy();
    await act(async () => keeping.reject(new Error('disk I/O error')));
    expect(screen.getByTestId('video-preview')).toBeTruthy();
  });

  test('a preview back after a failed hand-over plays the kept file, not the camera’s path it left', async () => {
    mockRemember.mockRejectedValueOnce(new Error('disk I/O error'));
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getByText('disk I/O error')).toBeTruthy();
    // Played from the documents of this run.
    expect(mockPreview.source).toBe(mediaFileUri(KEPT_URI));
  });

  test('sent, the screen says the video is queued and offers the way back itself', async () => {
    // Arrange
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert: it goes back by itself. The button comes only if the screen is
    // still there a moment later — never during the way out, where a second
    // «back» would close the step's screen too (review of d0a2738..ec46320).
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Видео в очереди: загрузится само, когда будет связь.')).toBeTruthy();
    expect(screen.queryByTestId('video-preview')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Вернуться к шагу' })).toBeNull();
    await wait(1_500);
    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться к шагу' }));
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  test('the file is moved only once the player is gone from the screen', async () => {
    // Arrange: what was on screen the moment the file began to move.
    let isPlayerThere: boolean | null = null;
    keep.mockImplementation(async ({ durationSec }) => {
      isPlayerThere = screen.queryByTestId('video-preview') !== null;
      return kept(durationSec);
    });
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert
    expect(isPlayerThere).toBe(false);
  });

  test('with nowhere to go back to, the way back is the step itself', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(false);
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/task/[id]/step/[stepId]',
      params: { id: TASK_ID, stepId: STEP_ID },
    });
  });

  test('a hand-over that failed is reported, not only marked', async () => {
    const failure = new Error('disk I/O error');
    mockRemember.mockRejectedValueOnce(failure);
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });

  test('a recording lost on its way to the documents offers no dead player, only «Переснять»', async () => {
    keep.mockRejectedValueOnce(
      Object.assign(new Error('The capture measured zero bytes'), { name: 'EmptyCaptureError' }),
    );
    await render(<RecordRoute />);
    await recordFor(5_000);

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.queryByTestId('video-preview')).toBeNull();
    expect(screen.getByText('Запись не сохранилась. Переснимите видео.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Отправить' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Переснять' }));
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
  });

  test('each link of the hand-over is marked for the crash report, without the file’s path', async () => {
    // Arrange
    await render(<RecordRoute />);
    await recordFor(5_000);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

    // Assert
    const marks = jest.mocked(Sentry.addBreadcrumb).mock.calls.map(([crumb]) => crumb);
    expect(marks.map((crumb) => `${crumb.category}:${crumb.message}`)).toEqual([
      'video.send:pressed',
      'video.send:kept',
      'video.send:remembered',
      'video.send:queued',
      'video.send:leaving',
    ]);
    expect(JSON.stringify(marks)).not.toMatch(/file:\/\//);
    expect(marks[1].data).toEqual({ mediaId: 'kept-id', byteSize: 21_000_000, durationSec: 5 });
  });

  test('the recording screen has a boundary of its own, with «Назад»', () => {
    expect(RecordErrorBoundary).toBe(RouteError);
  });
});

// On Android a header touched while its screen is being taken off the stack
// brings the app down: «ScreenStackFragment added into a non-stack
// container», 58 ms after «leaving» (Sentry, 2026-10-09 and 10-10). The
// screen goes on drawing during the pop — the queue lists the video, starts
// it — so its header is its own and nothing it draws reaches the system's.
describe('back first, then the screen draws again', () => {
  test('after «Отправить» the queue’s answers redraw it, and no header is touched', async () => {
    // Arrange
    const { rerender } = await render(<RecordRoute />);
    await recordFor(5_000);

    // Act: back, then the redraws of the pop's moment.
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
    expect(router.back).toHaveBeenCalledTimes(1);
    mockMedia.data = [stepVideo({ id: 'kept-id' })];
    mockUploading.ids = new Set(['kept-id']);
    await rerender(<RecordRoute />);
    await wait(2_000);

    // Assert
    expect(mockNavigation.setOptions).not.toHaveBeenCalled();
    expect(mockHeader.title).toBeUndefined();
  });

  test('the header’s «Назад» leaves the way the system’s did, through the same guard', async () => {
    await render(<RecordRoute />);
    await recordFor(5_000);
    expect(mockLeaveGuard.isOn).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));

    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
