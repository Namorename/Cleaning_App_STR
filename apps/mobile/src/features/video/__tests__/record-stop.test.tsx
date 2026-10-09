import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  HIDDEN_TOO,
  RECORDED_URI,
  RecordRoute,
  activateKeepAwakeAsync,
  appStateListenerCount,
  deactivateKeepAwake,
  deferred,
  discardFile,
  keep,
  mockAttach,
  mockCamera,
  mockFile,
  mockSteps,
  moveApp,
  navigationEvent,
  recordFor,
  setUpRecordRoute,
  videoStep,
  wait,
} from '@/testing/record-route';

/**
 * The recording screen of a video step while it records, and how a recording
 * ends: the countdown, the length measured, «Стоп» and a camera slow to
 * answer it, the app put away, the screen left, and the screen kept awake
 * meanwhile (docs/tech-plan.md §7.1).
 */

setUpRecordRoute();

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
  // Item 8 of the two whole-branch reviews of phone-1-2-0: the greyed button
  // says what is happening — to the eye and to the reader — not «Записать».
  test('the button says «Сохраняем…», greyed, until the camera has handed the file over', async () => {
    // Arrange: the camera takes its time.
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);

    // Act
    await recordFor(3_000);

    // Assert
    const button = screen.getByRole('button', { name: 'Сохраняем…' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Сохраняем…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Записать' })).toBeNull();
    await fireEvent.press(button);
    expect(mockCamera.recordAsync).toHaveBeenCalledTimes(1);
  });

  // Item 5 of the verification review of f3217a7..c466bf5: the reader hears
  // that it is saving once, and the countdown, stopped, is not read over it.
  test('«Сохраняем…» is said to the reader once, however long the camera takes', async () => {
    // Arrange
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);

    // Act
    await recordFor(3_000);
    await wait(5_000);

    // Assert
    const saying = announce.mock.calls.filter(([text]) => text === 'Сохраняем…');
    expect(saying).toHaveLength(1);
  });

  test('while it saves, the time left is no live region and is not said', async () => {
    // Arrange
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    mockCamera.stopRecording.mockImplementation(() => undefined);
    await render(<RecordRoute />);
    await recordFor(3_000);
    const before = announce.mock.calls.length;

    // Act
    await wait(5_000);

    // Assert
    const said = announce.mock.calls.slice(before).map(([text]) => text);
    expect(said.filter((text) => text.startsWith('Осталось'))).toEqual([]);
    expect(screen.getByText(/^Осталось/).props.accessibilityLiveRegion).toBe('none');
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
    expect(appStateListenerCount()).toBeGreaterThan(0);

    await unmount();

    expect(appStateListenerCount()).toBe(0);
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

  // The lock is taken asynchronously: let go before it was in place, it
  // would be taken after — and the screen kept on with nothing recording.
  test('a recording the camera refuses at once lets the screen sleep once the lock is in', async () => {
    // Arrange
    const events: string[] = [];
    const lock = deferred<void>();
    jest.mocked(activateKeepAwakeAsync).mockImplementation(() => {
      events.push('asked');
      return lock.promise.then(() => {
        events.push('awake');
      });
    });
    jest.mocked(deactivateKeepAwake).mockImplementation(async () => {
      events.push('released');
    });
    await render(<RecordRoute />);

    // Act: the camera refuses before the lock is in place.
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));
    await act(async () => mockCamera.fail?.(new Error('Camera is in use by another app')));
    await act(async () => lock.resolve());

    // Assert
    expect(events).toEqual(['asked', 'awake', 'released']);
  });

  test('a lock the phone would not give is let go all the same', async () => {
    const lock = deferred<void>();
    jest.mocked(activateKeepAwakeAsync).mockReturnValue(lock.promise);
    await render(<RecordRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Записать' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Стоп' }));
    expect(deactivateKeepAwake).not.toHaveBeenCalled();
    await act(async () => lock.reject(new Error('No activity to keep awake')));

    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No activity to keep awake' }),
    );
  });

  test('is not held awake before anything is recorded', async () => {
    const { unmount } = await render(<RecordRoute />);

    await unmount();

    expect(activateKeepAwakeAsync).not.toHaveBeenCalled();
  });
});
