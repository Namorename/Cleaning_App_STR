import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet, type ViewStyle } from 'react-native';

import {
  ME,
  NEVER_ASKED,
  RecordRoute,
  REFUSED,
  REFUSED_FOR_GOOD,
  GRANTED,
  mockCamera,
  mockDisk,
  mockMedia,
  mockPermissions,
  mockSteps,
  mockTask,
  mockUploading,
  mockVideo,
  moveApp,
  recordFor,
  setUpRecordRoute,
  stepVideo,
  videoStep,
} from '@/testing/record-route';

/**
 * The recording screen of a video step, before anything is recorded: the
 * camera it opens, the permissions it asks for, the checks of the step's own
 * button, the room on the phone, and a camera that will not work
 * (docs/tech-plan.md §7.1).
 */

setUpRecordRoute();

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

  // While it uploads, the step's tile hides «Удалить»: telling her to delete
  // it there would send her to a button she cannot find.
  test('a step whose video is still uploading says so, not to delete it', async () => {
    const uploading = stepVideo();
    mockMedia.data = [uploading];
    mockUploading.ids = new Set([uploading.id]);

    await render(<RecordRoute />);

    expect(
      screen.getByText(
        'У шага уже есть видео, оно ещё загружается. Когда загрузка закончится, его можно будет удалить на экране шага.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/удалите его на экране шага/)).toBeNull();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  // Not knowing the step's media is not knowing it has no video: a camera
  // opened then could record one the server refuses after she has made it.
  test('while the step’s media are still being read, no camera opens yet', async () => {
    mockMedia.isPending = true;
    mockMedia.data = undefined;

    await render(<RecordRoute />);

    expect(screen.getByText('Включаем камеру…')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  test('media that could not be read say so, and no camera opens', async () => {
    mockMedia.error = new Error('JWT expired');
    mockMedia.data = undefined;

    await render(<RecordRoute />);

    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('JWT expired')).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });

  // Without signal the list read last is still on the phone: it is what she sees on the step.
  test('media read before, and a refresh that failed, go by what was read', async () => {
    mockMedia.error = new Error('Network request failed');
    mockMedia.data = [];

    await render(<RecordRoute />);

    expect(screen.getByTestId('camera-preview')).toBeTruthy();
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
